import type { Logger } from 'pino';
import type { ActionIntent, PipelineResult, ActionPreview } from './action-types.js';
import type { ActionBuilder } from './action-builder.js';
import type { MevProtector } from './mev-protector.js';
import type { ChainAdapter } from '../chain/adapter.js';
import type { PolicyCheckRegistry } from '../policy/registry.js';
import type { PolicyContext } from '../policy/context.js';
import type { TradeLog, TradeRecord } from '../db/trade-log.js';
import type { Signer } from '../types/result.js';
import { REJECTED_BY_KEY } from '../policy/check.js';
import { toErrorMessage } from '../utils/index.js';

export interface PipelineInput {
  readonly intent: ActionIntent;
  readonly builder: ActionBuilder;
  readonly chainAdapter: ChainAdapter;
  readonly policyRegistry: PolicyCheckRegistry;
  readonly policyContext: PolicyContext;
  readonly mevProtector: MevProtector;
  readonly tradeLog: TradeLog;
  readonly logger: Logger;
  readonly signer?: Signer;
  readonly watchOnly: boolean;
  readonly tradeValueUsd?: number;
}

/**
 * Extract trade-log fields from an ActionIntent based on its discriminant.
 */
function extractTradeFields(
  intent: ActionIntent,
): Pick<TradeRecord, 'from_token' | 'to_token' | 'amount_in'> {
  switch (intent.action) {
    case 'swap':
      return {
        from_token: intent.params.coinTypeIn,
        to_token: intent.params.coinTypeOut,
        amount_in: intent.params.amountIn,
      };
    case 'supply':
      return {
        from_token: intent.params.coinType,
        to_token: intent.params.protocol,
        amount_in: intent.params.amount,
      };
  }
}

/**
 * Build a TradeRecord from the intent and outcome details.
 */
function buildTradeRecord(
  intent: ActionIntent,
  decision: 'approved' | 'rejected',
  opts?: {
    readonly txDigest?: string;
    readonly gasUsed?: number;
    readonly amountOut?: string;
    readonly rejectionReason?: string;
    readonly rejectionCheck?: string;
    readonly valueUsd?: number;
  },
): TradeRecord {
  const fields = extractTradeFields(intent);
  return {
    chain: intent.chain,
    wallet_address: intent.walletAddress,
    action: intent.action,
    from_token: fields.from_token,
    to_token: fields.to_token,
    amount_in: fields.amount_in,
    policy_decision: decision,
    ...(opts?.amountOut !== undefined ? { amount_out: opts.amountOut } : {}),
    ...(opts?.txDigest !== undefined ? { tx_digest: opts.txDigest } : {}),
    ...(opts?.gasUsed !== undefined ? { gas_cost: opts.gasUsed } : {}),
    ...(opts?.rejectionReason !== undefined ? { rejection_reason: opts.rejectionReason } : {}),
    ...(opts?.rejectionCheck !== undefined ? { rejection_check: opts.rejectionCheck } : {}),
    ...(opts?.valueUsd !== undefined ? { value_usd: opts.valueUsd } : {}),
  };
}

/**
 * Generic transaction pipeline orchestrator.
 *
 * ALL on-chain mutations MUST flow through this function — swaps, lending,
 * LP, staking, etc.
 *
 * Flow: validate -> policy -> preview -> build -> serialize -> simulate
 *       -> (watch-only?) -> MEV protect -> sign+submit -> log
 *
 * Returns a PipelineResult with one of 5 statuses:
 * - success: fully executed on-chain
 * - simulated: watch-only mode, stopped after simulation
 * - rejected: policy engine rejected the intent
 * - simulation_failed: dry-run failed
 * - error: unexpected failure
 */
export async function executePipeline(input: PipelineInput): Promise<PipelineResult> {
  const {
    intent,
    builder,
    chainAdapter,
    policyRegistry,
    policyContext,
    mevProtector,
    tradeLog,
    logger,
    signer,
    watchOnly,
    tradeValueUsd,
  } = input;

  const log = logger.child({ action: intent.action, chain: intent.chain });

  try {
    // Step 1: Validate intent params
    log.info('Validating intent');
    builder.validate(intent);

    // Step 2: Policy check
    log.info('Running policy checks');
    const checkResult = await policyRegistry.evaluateAll(intent, policyContext);
    if (checkResult.status === 'reject') {
      const rawRejectedBy = checkResult.metadata?.[REJECTED_BY_KEY];
      const rejectionCheck = typeof rawRejectedBy === 'string' ? rawRejectedBy : 'unknown';
      const rejectionReason = checkResult.detail ?? checkResult.reason ?? 'Policy rejected';

      log.info({ rejectionCheck, rejectionReason }, 'Intent rejected by policy');

      tradeLog.logTrade(
        buildTradeRecord(intent, 'rejected', {
          rejectionReason,
          rejectionCheck,
          ...(tradeValueUsd !== undefined ? { valueUsd: tradeValueUsd } : {}),
        }),
      );

      return {
        status: 'rejected',
        rejectionCheck,
        rejectionReason,
      };
    }

    // Step 3: Preview (fetch quotes/rates)
    log.info('Fetching preview');
    const preview: ActionPreview = await builder.preview(intent);

    // Step 4: Build transaction
    log.info('Building transaction');
    const built = await builder.build(intent, preview);

    // Step 5: Serialize to bytes
    log.info('Serializing transaction bytes');
    const txBytes = await chainAdapter.buildTransactionBytes(built.transaction);

    // Step 6: Simulate (dry-run)
    log.info('Simulating transaction');
    const simResult = await chainAdapter.simulate(txBytes, intent.walletAddress);
    if (!simResult.success) {
      log.info({ error: simResult.error }, 'Simulation failed');
      return {
        status: 'simulation_failed',
        error: simResult.error ?? 'Simulation failed',
      };
    }

    // Step 7: Watch-only check — stop after simulation
    if (watchOnly) {
      log.info('Watch-only mode — logging and returning simulated result');
      tradeLog.logTrade(
        buildTradeRecord(intent, 'approved', {
          txDigest: 'watch-only',
          gasUsed: simResult.gasEstimate,
          ...(tradeValueUsd !== undefined ? { valueUsd: tradeValueUsd } : {}),
        }),
      );

      return {
        status: 'simulated',
        preview,
        gasUsed: simResult.gasEstimate,
      };
    }

    // Step 8: MEV protection
    if (signer === undefined) {
      return {
        status: 'error',
        error: 'Signer is required for non-watch-only execution',
      };
    }

    log.info({ protector: mevProtector.name }, 'Applying MEV protection');
    const protectedTx = await mevProtector.protect(txBytes, intent.chain);

    // Step 9: Sign and submit
    log.info('Signing and submitting transaction');
    const txResult = await chainAdapter.signAndSubmit(protectedTx.bytes, signer);

    if (txResult.status !== 'success') {
      log.error({ txDigest: txResult.txDigest }, 'Transaction failed on-chain');
      return {
        status: 'error',
        error: `Transaction ${txResult.txDigest} failed on-chain`,
        txDigest: txResult.txDigest,
      };
    }

    // Step 10: Log success and return
    const amountOutStr =
      txResult.amountOut !== undefined ? txResult.amountOut.toString() : undefined;

    tradeLog.logTrade(
      buildTradeRecord(intent, 'approved', {
        txDigest: txResult.txDigest,
        gasUsed: txResult.gasUsed,
        ...(amountOutStr !== undefined ? { amountOut: amountOutStr } : {}),
        ...(tradeValueUsd !== undefined ? { valueUsd: tradeValueUsd } : {}),
      }),
    );

    log.info({ txDigest: txResult.txDigest, gasUsed: txResult.gasUsed }, 'Transaction succeeded');

    const result: PipelineResult = {
      status: 'success',
      txDigest: txResult.txDigest,
      gasUsed: txResult.gasUsed,
      preview,
      ...(amountOutStr !== undefined ? { amountOut: amountOutStr } : {}),
      ...(tradeValueUsd !== undefined ? { tradeValueUsd: tradeValueUsd } : {}),
    };

    return result;
  } catch (err: unknown) {
    const errorMessage = toErrorMessage(err);
    log.error({ error: errorMessage }, 'Pipeline error');
    return {
      status: 'error',
      error: errorMessage,
    };
  }
}
