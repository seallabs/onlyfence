import type { Command } from 'commander';
import { buildSuiSigner } from '../../chain/sui/signer.js';
import type { ActionBuilder } from '../../core/action-builder.js';
import type { Chain, ChainId, PipelineResult, SwapIntent } from '../../core/action-types.js';
import { NoOpMevProtector } from '../../core/mev-protector.js';
import { executePipeline } from '../../core/transaction-pipeline.js';
import { detectExecutionMode, DaemonClient } from '../../daemon/index.js';
import type { PolicyContext } from '../../policy/context.js';
import { captureException } from '../../telemetry/index.js';
import { toErrorMessage } from '../../utils/index.js';
import { getPrimaryWallet } from '../../wallet/manager.js';
import { loadSessionKeyBytes } from '../../wallet/session.js';
import type { AppComponents } from '../bootstrap.js';
import type { CliOutput, MappedOutput, SwapOutput } from '../output.js';
import { EXIT_CODES, printJsonOutput } from '../output.js';
import { resolveTokenInput } from '../resolve.js';
import { withComponents } from '../with-components.js';

/** Shared fallback MEV protector for chains without a registered protector. */
const FALLBACK_MEV_PROTECTOR = new NoOpMevProtector();

/**
 * Register the `fence swap` command on the given program.
 *
 * Flow:
 * 1. Parse args into SwapIntent
 * 2. Load wallet for chain, check watch-only
 * 3. Resolve token symbols to coin types
 * 4. Fetch oracle price, build PolicyContext
 * 5. Resolve signer (unless watch-only)
 * 6. Call executePipeline
 * 7. Map PipelineResult to CliOutput + exit code
 */
export function registerSwapCommand(program: Command, getComponents: () => AppComponents): void {
  program
    .command('swap <fromToken> <toToken> <amount>')
    .description('Execute a swap with policy enforcement')
    .option('-s, --slippage <percent>', 'Slippage tolerance in percent', '0.5')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .option('-o, --output <format>', 'Output format (json)', 'json')
    .action(
      async (
        fromToken: string,
        toToken: string,
        amountStr: string,
        options: {
          slippage: string;
          chain: Chain;
          output: string;
        },
      ) => {
        // Auto-detect: if daemon is running, route through it
        const execMode = detectExecutionMode();
        if (execMode.mode === 'daemon-client') {
          await executeViaDaemon(execMode.address, fromToken, toToken, amountStr, options);
          return;
        }

        // In-process execution (Tier 0)
        const components = withComponents(getComponents);
        if (components === undefined) return;

        const {
          db,
          config,
          dataProviders,
          policyRegistry,
          activityLog,
          chainAdapterFactory,
          actionBuilderRegistry,
          mevProtectors,
          logger,
        } = components;
        const chain = options.chain;
        const chainId: ChainId = `${chain}:mainnet`;
        const log = logger.child({ command: 'swap' });

        try {
          // Validate chain config exists
          const chainConfig = config.chain[chain];

          // Get wallet address
          const wallet = getPrimaryWallet(db, chainId);
          if (wallet === null) {
            throw new Error(
              `No primary wallet found for chain "${chainId}". Run "fence setup" first.`,
            );
          }

          const watchOnly = wallet.isWatchOnly;

          log.info(
            { fromToken, toToken, amount: amountStr, chain, watchOnly },
            'Swap command invoked',
          );

          // Get chain adapter and data provider
          const chainAdapter = chainAdapterFactory.get(chain);
          const dataProvider = dataProviders.get(chain);

          // === Resolve CLI inputs to stable internal representations ===
          // resolveTokenInput handles alias resolution (case-insensitive),
          // coin type normalization, decimal fetching, and amount scaling.
          const resolvedIn = await resolveTokenInput(
            fromToken,
            amountStr,
            chainAdapter,
            dataProvider,
          );
          const { coinType: coinTypeIn, scaledAmount: scaledAmountIn } = resolvedIn;
          const coinTypeOut = chainAdapter.resolveTokenAddress(toToken);

          // Build slippage in basis points
          const slippageBps = Math.round(parseFloat(options.slippage) * 100);
          // PriceCache (wrapping the data provider) implements fail-closed:
          // if the oracle is unreachable and the cache is stale (>5 min),
          // getPrice() throws OracleStalePriceError — the trade is rejected.
          const price = await dataProvider.getPrice(coinTypeIn);
          const tradeValueUsd: number = parseFloat(amountStr) * price;

          // Build SwapIntent
          const intent: SwapIntent = {
            chainId,
            action: 'trade:swap',
            walletAddress: wallet.address,
            params: {
              coinTypeIn,
              coinTypeOut,
              amountIn: scaledAmountIn,
              slippageBps,
            },
            tradeValueUsd,
          };

          // Build policy context
          const policyCtx: PolicyContext = {
            config: chainConfig,
            activityLog,
            tradeValueUsd,
          };

          // Resolve signer from active session if not watch-only
          const signer = watchOnly ? undefined : buildSuiSigner(loadSessionKeyBytes(chainId));

          // Get builder from registry
          const builder = actionBuilderRegistry.getDefault(
            chain,
            'trade:swap',
            intent,
          ) as ActionBuilder<SwapIntent>;

          // Get MEV protector (fallback to NoOp)
          const mevProtector = mevProtectors.get(chain) ?? FALLBACK_MEV_PROTECTOR;

          // Execute pipeline
          const result = await executePipeline({
            intent,
            builder,
            chainAdapter,
            policyRegistry,
            policyContext: policyCtx,
            mevProtector,
            logger: log,
            ...(signer !== undefined ? { signer } : {}),
            watchOnly,
            dataProvider,
          });

          // Map PipelineResult to CliOutput + exit code
          const output = mapPipelineResultToOutput(result, intent, tradeValueUsd);
          printJsonOutput(output.cliOutput);
          process.exitCode = output.exitCode;
        } catch (err: unknown) {
          log.error({ err }, 'Swap failed');
          captureException(err);
          const errorOutput: CliOutput = {
            status: 'error',
            action: 'trade:swap',
            chainId,
            address: '',
            error: toErrorMessage(err),
          };
          printJsonOutput(errorOutput);
          process.exitCode = 1;
        }
      },
    );
}

/**
 * Map a PipelineResult to a CliOutput and process exit code.
 */
function mapPipelineResultToOutput(
  result: PipelineResult,
  intent: SwapIntent,
  tradeValueUsd?: number,
): MappedOutput {
  const meta = result.metadata;

  const base: CliOutput<SwapOutput> = {
    status: result.status,
    action: intent.action,
    chainId: intent.chainId,
    address: intent.walletAddress,
    gasUsed: result.gasUsed,
    txDigest: result.txDigest,
    error: result.error,
    rejectionCheck: result.rejectionCheck,
    rejectionReason: result.rejectionReason,
  };

  const hasPayload = result.status === 'success' || result.status === 'simulated';
  const payload: SwapOutput | undefined = hasPayload
    ? {
        fromToken: intent.params.coinTypeIn,
        toToken: intent.params.coinTypeOut,
        amountIn: parseFloat(intent.params.amountIn),
        amountOut: parseFloat((meta?.['expectedOutput'] as string | undefined) ?? '0'),
        valueUsd: tradeValueUsd ?? null,
      }
    : undefined;

  return {
    cliOutput: { ...base, ...(payload !== undefined ? { payload } : {}) },
    exitCode: EXIT_CODES[result.status],
  };
}

/**
 * Execute a swap via the daemon's IPC socket (thin client mode).
 */
async function executeViaDaemon(
  address: string,
  fromToken: string,
  toToken: string,
  amountStr: string,
  options: { slippage: string; chain: Chain },
): Promise<void> {
  const client = new DaemonClient(address);
  const chainId: ChainId = `${options.chain}:mainnet`;
  const slippageBps = Math.round(parseFloat(options.slippage) * 100);

  try {
    const response = await client.send('trade', {
      intent: {
        chainId,
        action: 'trade:swap',
        walletAddress: '', // Daemon resolves the wallet
        params: {
          coinTypeIn: fromToken,
          coinTypeOut: toToken,
          amountIn: amountStr,
          slippageBps,
        },
      },
    });

    // The daemon always returns data.result with the pipeline result,
    // even on failure — extract it to show the real error/rejection.
    const data = response.data as { result?: PipelineResult } | undefined;
    const result = data?.result;

    if (result !== undefined) {
      printJsonOutput({
        status: result.status,
        action: 'trade:swap',
        chainId,
        address: '',
        txDigest: result.txDigest,
        gasUsed: result.gasUsed,
        error: result.error,
        rejectionCheck: result.rejectionCheck,
        rejectionReason: result.rejectionReason,
      });
      process.exitCode = EXIT_CODES[result.status];
    } else {
      printJsonOutput({
        status: 'error',
        action: 'trade:swap',
        chainId,
        address: '',
        error: response.error ?? 'Daemon returned no result',
      });
      process.exitCode = 1;
    }
  } catch (err: unknown) {
    printJsonOutput({
      status: 'error',
      action: 'trade:swap',
      chainId,
      address: '',
      error: toErrorMessage(err),
    });
    process.exitCode = 1;
  }
}
