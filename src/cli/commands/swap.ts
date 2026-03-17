import type { Command } from 'commander';
import type { SwapIntent, PipelineResult } from '../../core/action-types.js';
import type { PolicyContext } from '../../policy/context.js';
import type { AppComponents } from '../bootstrap.js';
import type {
  SuccessResponse,
  RejectionResponse,
  ErrorResponse,
  SimulatedResponse,
  CliOutput,
} from '../output.js';
import { getPrimaryWallet } from '../../wallet/manager.js';
import { printJsonOutput } from '../output.js';
import { toErrorMessage } from '../../utils/index.js';
import { resolveTokenAddress, scaleToSmallestUnit } from '../../chain/sui/tokens.js';
import { resolveSuiSigner } from '../../wallet/signer.js';
import { executePipeline } from '../../core/transaction-pipeline.js';
import { NoOpMevProtector } from '../../core/mev-protector.js';

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
    .option('-p, --password <password>', 'Keystore password for signing')
    .option('-o, --output <format>', 'Output format (json)', 'json')
    .action(
      async (
        fromToken: string,
        toToken: string,
        amountStr: string,
        options: {
          slippage: string;
          chain: string;
          password?: string;
          output: string;
        },
      ) => {
        let components: AppComponents;
        try {
          components = getComponents();
        } catch (err: unknown) {
          const errorOutput: ErrorResponse = {
            status: 'error',
            message: toErrorMessage(err),
          };
          printJsonOutput(errorOutput);
          process.exitCode = 1;
          return;
        }

        const {
          db,
          config,
          oracle,
          policyRegistry,
          tradeLog,
          chainAdapterFactory,
          actionBuilderRegistry,
          mevProtectors,
          coinMetadataService,
          logger,
        } = components;
        const chain = options.chain;
        const log = logger.child({ command: 'swap' });

        try {
          // Validate chain config exists
          const chainConfig = config.chain[chain];
          if (chainConfig === undefined) {
            throw new Error(
              `No configuration found for chain "${chain}". ` +
                `Available chains: ${Object.keys(config.chain).join(', ')}`,
            );
          }

          // Get wallet address
          const wallet = getPrimaryWallet(db, chain);
          if (wallet === null) {
            throw new Error(
              `No primary wallet found for chain "${chain}". Run "fence setup" first.`,
            );
          }

          const watchOnly = wallet.isWatchOnly;

          log.info(
            { fromToken, toToken, amount: amountStr, chain, watchOnly },
            'Swap command invoked',
          );

          // === Resolve CLI inputs to stable internal representations ===
          // Token aliases (SUI, USDC) → fully-qualified coin types (0x2::sui::SUI)
          // Human-readable amount (100.5) → smallest unit string (100500000000)
          // These resolved values are the source of truth for all downstream code.
          const coinTypeIn = resolveTokenAddress(fromToken.toUpperCase());
          const coinTypeOut = resolveTokenAddress(toToken.toUpperCase());

          // Resolve decimals remotely (Noodles API) with local fallback
          const decimals = await coinMetadataService.getDecimals(coinTypeIn, chain);
          const scaledAmountIn = scaleToSmallestUnit(amountStr, decimals);

          // Build slippage in basis points
          const slippageBps = Math.round(parseFloat(options.slippage) * 100);

          // Build SwapIntent
          const intent: SwapIntent = {
            chain,
            action: 'swap',
            walletAddress: wallet.address,
            params: {
              coinTypeIn,
              coinTypeOut,
              amountIn: scaledAmountIn,
              slippageBps,
            },
          };

          // Resolve USD price from oracle (handle failure per spec section 10)
          let tradeValueUsd: number | undefined;
          try {
            const price = await oracle.getPrice(fromToken.toUpperCase());
            tradeValueUsd = parseFloat(amountStr) * price;
          } catch (err: unknown) {
            log.warn(
              { token: fromToken, error: toErrorMessage(err) },
              'Oracle price unavailable; USD spending limits will not be enforced',
            );
            tradeValueUsd = undefined;
          }

          // Build policy context
          const policyCtx: PolicyContext = {
            config: chainConfig,
            db,
            oracle,
            tradeLog,
            ...(tradeValueUsd !== undefined ? { tradeValueUsd } : {}),
          };

          // Resolve signer if not watch-only
          const signer = watchOnly ? undefined : resolveSuiSigner(options.password);

          // Get builder from registry
          const builder = actionBuilderRegistry.getDefault(chain, 'swap', intent);

          // Get chain adapter
          const chainAdapter = chainAdapterFactory.get(chain);

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
            tradeLog,
            logger: log,
            ...(signer !== undefined ? { signer } : {}),
            watchOnly,
            ...(tradeValueUsd !== undefined ? { tradeValueUsd } : {}),
          });

          // Map PipelineResult to CliOutput + exit code
          const output = mapPipelineResultToOutput(result, intent);
          printJsonOutput(output.cliOutput);
          process.exitCode = output.exitCode;
        } catch (err: unknown) {
          log.error({ err: toErrorMessage(err) }, 'Swap failed');
          const errorOutput: ErrorResponse = {
            status: 'error',
            message: toErrorMessage(err),
          };
          printJsonOutput(errorOutput);
          process.exitCode = 1;
        }
      },
    );
}

/**
 * Result of mapping a PipelineResult to CLI output.
 */
interface MappedOutput {
  readonly cliOutput: CliOutput;
  readonly exitCode: number;
}

/**
 * Map a PipelineResult to a CliOutput and process exit code.
 */
function mapPipelineResultToOutput(result: PipelineResult, intent: SwapIntent): MappedOutput {
  switch (result.status) {
    case 'success': {
      const output: SuccessResponse = {
        status: 'success',
        chain: intent.chain,
        action: intent.action,
        txDigest: result.txDigest ?? '',
        fromToken: intent.params.coinTypeIn,
        toToken: intent.params.coinTypeOut,
        amountIn: intent.params.amountIn,
        amountOut: result.amountOut ?? result.preview?.expectedOutput ?? '0',
        valueUsd: result.tradeValueUsd ?? null,
        gasCost: result.gasUsed ?? 0,
        route: result.preview?.provider ?? 'unknown',
      };
      return { cliOutput: output, exitCode: 0 };
    }

    case 'simulated': {
      const output: SimulatedResponse = {
        status: 'simulated',
        chain: intent.chain,
        action: intent.action,
        fromToken: intent.params.coinTypeIn,
        toToken: intent.params.coinTypeOut,
        amountIn: intent.params.amountIn,
        expectedOutput: result.preview?.expectedOutput ?? '0',
        provider: result.preview?.provider ?? 'unknown',
        ...(result.preview?.priceImpact !== undefined
          ? { priceImpact: result.preview.priceImpact }
          : {}),
        gasEstimate: result.gasUsed ?? 0,
      };
      return { cliOutput: output, exitCode: 0 };
    }

    case 'rejected': {
      const output: RejectionResponse = {
        status: 'rejected',
        chain: intent.chain,
        action: intent.action,
        check: result.rejectionCheck ?? 'unknown',
        reason: result.rejectionReason ?? 'policy_rejected',
        detail: result.rejectionReason ?? 'Trade rejected by policy engine',
      };
      return { cliOutput: output, exitCode: 3 };
    }

    case 'simulation_failed': {
      const output: ErrorResponse = {
        status: 'error',
        message: `Simulation failed: ${result.error ?? 'unknown error'}`,
      };
      return { cliOutput: output, exitCode: 4 };
    }

    case 'error': {
      const output: ErrorResponse = {
        status: 'error',
        message: result.error ?? 'Unknown pipeline error',
      };
      return { cliOutput: output, exitCode: 1 };
    }
  }
}
