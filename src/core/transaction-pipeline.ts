import type { Logger } from 'pino';
import type { ChainAdapter } from '../chain/adapter.js';
import { REJECTED_BY_KEY } from '../policy/check.js';
import type { PolicyContext } from '../policy/context.js';
import type { PolicyCheckRegistry } from '../policy/registry.js';
import type { Signer } from '../types/result.js';
import { toErrorMessage } from '../utils/index.js';
import type { ActionBuilder } from './action-builder.js';
import type { ActionIntent, ActionPreviewBase, PipelineResult } from './action-types.js';
import type { MevProtector } from './mev-protector.js';

export interface PipelineInput<P extends ActionPreviewBase = ActionPreviewBase> {
  readonly intent: ActionIntent;
  readonly builder: ActionBuilder<ActionIntent, P>;
  readonly chainAdapter: ChainAdapter;
  readonly policyRegistry: PolicyCheckRegistry;
  readonly policyContext: PolicyContext;
  readonly mevProtector: MevProtector;
  readonly logger: Logger;
  readonly signer?: Signer;
  readonly watchOnly: boolean;
}

/**
 * Generic transaction pipeline orchestrator.
 *
 * ALL on-chain mutations MUST flow through this function — swaps, lending,
 * LP, staking, etc.
 *
 * Flow: validate -> policy -> preview -> build -> serialize -> simulate
 *       -> (watch-only?) -> MEV protect -> sign+submit -> finish
 *
 * The pipeline delegates post-execution concerns (event parsing, trade
 * logging) to the builder's optional finish() hook. This keeps the
 * pipeline generic and action-agnostic.
 *
 * Returns a PipelineResult with one of 5 statuses:
 * - success: fully executed on-chain
 * - simulated: watch-only mode, stopped after simulation
 * - rejected: policy engine rejected the intent
 * - simulation_failed: dry-run failed
 * - error: unexpected failure
 */
export async function executePipeline<P extends ActionPreviewBase>(
  input: PipelineInput<P>,
): Promise<PipelineResult<P>> {
  const {
    intent,
    builder,
    chainAdapter,
    policyRegistry,
    policyContext,
    mevProtector,
    logger,
    signer,
    watchOnly,
  } = input;

  const log = logger.child({ action: intent.action, chainId: intent.chainId });

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

      builder.finish?.({
        intent,
        status: 'rejected',
        rejection: { check: rejectionCheck, reason: rejectionReason },
      });

      return {
        status: 'rejected',
        rejectionCheck,
        rejectionReason,
      };
    }

    // Step 3: Preview (fetch quotes/rates)
    log.info('Fetching preview');
    const preview = await builder.preview(intent);

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
      log.info('Watch-only mode — finishing and returning simulated result');

      builder.finish?.({
        intent,
        status: 'approved',
        preview,
        rawResponse: simResult.rawResponse,
        txDigest: 'watch-only',
        gasUsed: simResult.gasEstimate,
      });

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
    const protectedTx = await mevProtector.protect(txBytes, intent.chainId);

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

    // Step 10: Delegate event parsing and trade logging to the builder
    builder.finish?.({
      intent,
      status: 'approved',
      preview,
      rawResponse: txResult.rawResponse,
      txDigest: txResult.txDigest,
      gasUsed: txResult.gasUsed,
    });

    log.info({ txDigest: txResult.txDigest, gasUsed: txResult.gasUsed }, 'Transaction succeeded');

    return {
      status: 'success',
      txDigest: txResult.txDigest,
      gasUsed: txResult.gasUsed,
      preview,
    };
  } catch (err: unknown) {
    const errorMessage = toErrorMessage(err);
    log.error({ error: errorMessage }, 'Pipeline error');
    return {
      status: 'error',
      error: errorMessage,
    };
  }
}
