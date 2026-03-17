import type { Command } from 'commander';
import type { Logger } from 'pino';
import type { TradeIntent } from '../../types/intent.js';
import type { PolicyContext } from '../../policy/context.js';
import type { CheckResult } from '../../types/result.js';
import type { AppComponents } from '../bootstrap.js';
import type { ChainConfig } from '../../types/config.js';
import type { ChainAdapter } from '../../chain/adapter.js';
import type { TradeLog } from '../../db/trade-log.js';
import type { PolicyCheckRegistry } from '../../policy/registry.js';
import type { OracleClient } from '../../oracle/client.js';
import { getPrimaryWallet } from '../../wallet/manager.js';
import { printJsonOutput } from '../output.js';
import type { SuccessResponse, RejectionResponse, ErrorResponse } from '../output.js';
import { toErrorMessage, safeBigIntToNumber, parseBigIntAmount } from '../../utils/index.js';
import { REJECTED_BY_KEY } from '../../policy/check.js';
import { resolveTokenAddress } from '../../chain/index.js';
import { withComponents } from '../with-components.js';

/**
 * Register the `fence swap` command on the given program.
 *
 * Flow per spec section 3:
 * 1. Parse args into TradeIntent
 * 2. Load wallet for chain
 * 3. Create PolicyContext
 * 4. Resolve USD price via oracle
 * 5. Run policy pipeline
 * 6. If rejected: output rejection JSON and exit
 * 7. If approved: call chain adapter for quote, simulate, sign, submit
 * 8. Log trade to SQLite
 * 9. Output success JSON
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
          chain: string;
          output: string;
        },
      ) => {
        const components = withComponents(getComponents);
        if (components === undefined) return;

        const { db, config, oracle, policyRegistry, chainAdapterFactory, tradeLog, logger } =
          components;
        const chainAlias = options.chain;
        const log = logger.child({ command: 'swap' });

        try {
          const { chainConfig, adapter, intent, tradeValueUsd } = await buildSwapIntent({
            config,
            chainAdapterFactory,
            oracle,
            db,
            log,
            chainAlias,
            fromToken,
            toToken,
            amountStr,
          });

          const policyResult = await runPolicies({
            policyRegistry,
            intent,
            chainConfig,
            oracle,
            tradeLog,
            tradeValueUsd,
          });

          if (policyResult.status === 'reject') {
            handleRejection({ policyResult, intent, tradeLog, tradeValueUsd, log });
            return;
          }

          await executeAndLog({
            adapter,
            intent,
            tradeLog,
            tradeValueUsd,
            slippage: options.slippage,
            log,
          });
        } catch (err: unknown) {
          const message = toErrorMessage(err);
          log.error({ err: message }, 'Swap failed');
          const errorOutput: ErrorResponse = { status: 'error', message };
          printJsonOutput(errorOutput);
          process.exitCode = 1;
        }
      },
    );
}

// ─── Extracted steps ────────────────────────────────────────────────

interface BuildSwapIntentParams {
  readonly config: AppComponents['config'];
  readonly chainAdapterFactory: AppComponents['chainAdapterFactory'];
  readonly oracle: OracleClient;
  readonly db: AppComponents['db'];
  readonly log: Logger;
  readonly chainAlias: string;
  readonly fromToken: string;
  readonly toToken: string;
  readonly amountStr: string;
}

interface SwapIntentResult {
  readonly chainConfig: ChainConfig;
  readonly adapter: ChainAdapter;
  readonly intent: TradeIntent;
  readonly tradeValueUsd: number | undefined;
}

/**
 * Validate inputs, resolve wallet, build TradeIntent, and resolve USD price.
 */
async function buildSwapIntent(params: BuildSwapIntentParams): Promise<SwapIntentResult> {
  const {
    config,
    chainAdapterFactory,
    oracle,
    db,
    log,
    chainAlias,
    fromToken,
    toToken,
    amountStr,
  } = params;

  const chainConfig = config.chain[chainAlias];
  if (chainConfig === undefined) {
    throw new Error(
      `No configuration found for chain "${chainAlias}". ` +
        `Available chains: ${Object.keys(config.chain).join(', ')}`,
    );
  }

  const adapter = chainAdapterFactory.get(chainAlias);
  const chainId = adapter.chainId;
  const amount = parseBigIntAmount(amountStr);

  const wallet = getPrimaryWallet(db, chainId);
  if (wallet === null) {
    throw new Error(`No primary wallet found for chain "${chainAlias}". Run "fence setup" first.`);
  }

  log.info({ fromToken, toToken, amount: amountStr, chain: chainId }, 'Swap command invoked');

  const intent: TradeIntent = {
    chain: chainId,
    action: 'swap',
    fromToken: fromToken.toUpperCase(),
    toToken: toToken.toUpperCase(),
    amount,
    walletAddress: wallet.address,
  };

  const tradeValueUsd = await resolveTradeValue(oracle, intent, log);

  return { chainConfig, adapter, intent, tradeValueUsd };
}

/**
 * Resolve USD value from oracle. Returns undefined on failure (non-fatal).
 */
async function resolveTradeValue(
  oracle: OracleClient,
  intent: TradeIntent,
  log: Logger,
): Promise<number | undefined> {
  try {
    const price = await oracle.getPrice(intent.fromToken);
    return safeBigIntToNumber(intent.amount) * price;
  } catch (err: unknown) {
    log.warn(
      { err: toErrorMessage(err), token: intent.fromToken },
      'Oracle price unavailable — USD spending limits will not be enforced',
    );
    return undefined;
  }
}

interface RunPoliciesParams {
  readonly policyRegistry: PolicyCheckRegistry;
  readonly intent: TradeIntent;
  readonly chainConfig: ChainConfig;
  readonly oracle: OracleClient;
  readonly tradeLog: TradeLog;
  readonly tradeValueUsd: number | undefined;
}

/**
 * Evaluate all policy checks against the intent.
 */
async function runPolicies(params: RunPoliciesParams): Promise<CheckResult> {
  const { policyRegistry, intent, chainConfig, oracle, tradeLog, tradeValueUsd } = params;

  const policyCtx: PolicyContext = {
    config: chainConfig,
    oracle,
    tradeLog,
    ...(tradeValueUsd !== undefined ? { tradeValueUsd } : {}),
  };

  return policyRegistry.evaluateAll(intent, policyCtx);
}

interface HandleRejectionParams {
  readonly policyResult: CheckResult;
  readonly intent: TradeIntent;
  readonly tradeLog: TradeLog;
  readonly tradeValueUsd: number | undefined;
  readonly log: Logger;
}

/**
 * Log rejection to DB and print rejection JSON output.
 */
function handleRejection(params: HandleRejectionParams): void {
  const { policyResult, intent, tradeLog, tradeValueUsd, log } = params;

  log.info({ reason: policyResult.reason }, 'Trade rejected by policy');

  const rejectedByRaw = policyResult.metadata?.[REJECTED_BY_KEY];
  const rejectionCheck = typeof rejectedByRaw === 'string' ? rejectedByRaw : 'unknown';

  tradeLog.logTrade({
    chain: intent.chain,
    wallet_address: intent.walletAddress,
    action: intent.action,
    from_token: intent.fromToken,
    to_token: intent.toToken,
    amount_in: intent.amount.toString(),
    ...(tradeValueUsd !== undefined ? { value_usd: tradeValueUsd } : {}),
    policy_decision: 'rejected',
    ...(policyResult.reason !== undefined ? { rejection_reason: policyResult.reason } : {}),
    rejection_check: rejectionCheck,
  });

  const rejectionOutput: RejectionResponse = {
    status: 'rejected',
    chain: intent.chain,
    action: intent.action,
    check: rejectionCheck,
    reason: policyResult.reason ?? 'policy_rejected',
    detail: policyResult.detail ?? 'Trade rejected by policy engine',
    ...(policyResult.metadata !== undefined ? { metadata: policyResult.metadata } : {}),
  };

  printJsonOutput(rejectionOutput);
  process.exitCode = 1;
}

interface ExecuteAndLogParams {
  readonly adapter: ChainAdapter;
  readonly intent: TradeIntent;
  readonly tradeLog: TradeLog;
  readonly tradeValueUsd: number | undefined;
  readonly slippage: string;
  readonly log: Logger;
}

/**
 * Execute the on-chain swap and log the result.
 */
async function executeAndLog(params: ExecuteAndLogParams): Promise<void> {
  const { adapter, intent, tradeLog, tradeValueUsd, slippage, log } = params;

  // Resolve coin types for DB storage (non-fatal if unknown)
  let fromCoinType: string | undefined;
  let toCoinType: string | undefined;
  try {
    fromCoinType = resolveTokenAddress(intent.fromToken);
    toCoinType = resolveTokenAddress(intent.toToken);
  } catch (err: unknown) {
    log.debug(
      { err: toErrorMessage(err), fromToken: intent.fromToken, toToken: intent.toToken },
      'Token not in registry — coin types will be omitted from DB',
    );
  }

  const slippageNum = parseFloat(slippage);

  const quote = await adapter.getSwapQuote({
    fromToken: intent.fromToken,
    toToken: intent.toToken,
    amount: intent.amount,
    slippage: slippageNum,
    walletAddress: intent.walletAddress,
  });

  const txData = await adapter.buildSwapTx(quote);
  const simResult = await adapter.simulateTx(txData);

  if (!simResult.success) {
    throw new Error(`Transaction simulation failed: ${simResult.error ?? 'unknown error'}`);
  }

  // For now, sign and submit requires a signer which needs keystore password
  // This is a placeholder - the SuiAdapter methods throw "not implemented"
  // In production, we would prompt for password, load keystore, and create signer
  const txResult = await adapter.signAndSubmit(txData, {
    address: intent.walletAddress,
    sign: (_data: Uint8Array): Promise<Uint8Array> => Promise.resolve(new Uint8Array(64)),
  });

  tradeLog.logTrade({
    chain: intent.chain,
    wallet_address: intent.walletAddress,
    action: intent.action,
    from_token: intent.fromToken,
    to_token: intent.toToken,
    amount_in: intent.amount.toString(),
    ...(txResult.amountOut !== undefined ? { amount_out: txResult.amountOut.toString() } : {}),
    ...(tradeValueUsd !== undefined ? { value_usd: tradeValueUsd } : {}),
    tx_digest: txResult.txDigest,
    gas_cost: txResult.gasUsed,
    policy_decision: 'approved',
    ...(fromCoinType !== undefined ? { from_coin_type: fromCoinType } : {}),
    ...(toCoinType !== undefined ? { to_coin_type: toCoinType } : {}),
  });

  const successOutput: SuccessResponse = {
    status: 'success',
    chain: intent.chain,
    action: intent.action,
    txDigest: txResult.txDigest,
    fromToken: intent.fromToken,
    toToken: intent.toToken,
    amountIn: intent.amount.toString(),
    amountOut: txResult.amountOut?.toString() ?? '0',
    valueUsd: tradeValueUsd ?? null,
    gasCost: txResult.gasUsed,
    route: quote.route,
  };

  log.info({ txDigest: txResult.txDigest }, 'Swap executed successfully');

  printJsonOutput(successOutput);
}
