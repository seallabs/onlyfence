import type { Logger } from 'pino';
import type { ChainAdapter } from '../chain/adapter.js';
import { REJECTED_BY_KEY } from '../policy/check.js';
import type { PolicyContext } from '../policy/context.js';
import type { PolicyCheckRegistry } from '../policy/registry.js';
import { captureException } from '../telemetry/index.js';
import type { Signer } from '../types/result.js';
import { toErrorMessage } from '../utils/index.js';
import type { ActionBuilder } from './action-builder.js';
import type { ActionIntent, PipelineResult } from './action-types.js';
import { extractCoinTypes } from './action-types.js';
import type { DataProvider } from './data-provider.js';
import type { MevProtector } from './mev-protector.js';

export interface PipelineInput {
  readonly intent: ActionIntent;
  readonly builder: ActionBuilder;
  readonly chainAdapter: ChainAdapter;
  readonly policyRegistry: PolicyCheckRegistry;
  readonly policyContext: PolicyContext;
  readonly mevProtector: MevProtector;
  readonly logger: Logger;
  readonly signer?: Signer;
  readonly watchOnly: boolean;
  /** When provided, the pipeline caches coin metadata for all intent coin types after build. */
  readonly dataProvider?: DataProvider;
}

/**
 * Generic transaction pipeline orchestrator.
 *
 * ALL on-chain mutations MUST flow through this function — swaps, lending,
 * LP, staking, etc.
 *
 * Flow: validate -> policy -> build -> serialize -> simulate
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
export async function executePipeline(input: PipelineInput): Promise<PipelineResult> {
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

    // Step 2.5: Cache coin metadata for all intent coin types (best-effort)
    if (input.dataProvider !== undefined) {
      const coinTypes = extractCoinTypes(intent);
      if (coinTypes.length > 0) {
        input.dataProvider.getMetadatas(coinTypes).catch((err: unknown) => {
          log.warn({ error: toErrorMessage(err) }, 'Coin metadata caching failed');
        });
      }
    }

    // Branch: off-chain-signed execution strategy
    const strategy = builder.executionStrategy ?? 'on-chain';

    if (strategy === 'off-chain-signed') {
      // Watch-only: return simulated without executing
      if (watchOnly) {
        builder.finish?.({ intent, status: 'approved', metadata: {} });
        return { status: 'simulated', metadata: {} };
      }

      if (builder.execute === undefined) {
        return { status: 'error', error: 'Off-chain builder missing execute() method' };
      }

      log.info('Executing off-chain signed action');
      const result = await builder.execute(intent);

      builder.finish?.({
        intent,
        status: 'approved',
        metadata: result.metadata,
      });

      return { status: 'success', metadata: result.metadata };
    }

    // Step 3: Build transaction (includes quote fetching)
    log.info('Building transaction');
    const built = await builder.build(intent);

    // Step 4: Serialize to bytes
    log.info('Serializing transaction bytes');
    const txBytes = await chainAdapter.buildTransactionBytes(built.transaction);

    // Step 5: Simulate (dry-run)
    log.info('Simulating transaction');
    const simResult = await chainAdapter.simulate(txBytes, intent.walletAddress);
    if (!simResult.success) {
      log.info({ error: simResult.error }, 'Simulation failed');
      return {
        status: 'simulation_failed',
        error: simResult.error ?? 'Simulation failed',
      };
    }

    // Step 6: Watch-only check — stop after simulation
    if (watchOnly) {
      log.info('Watch-only mode — finishing and returning simulated result');

      builder.finish?.({
        intent,
        status: 'approved',
        metadata: built.metadata,
        rawResponse: simResult.rawResponse,
        txDigest: 'watch-only',
        gasUsed: simResult.gasEstimate,
      });

      return {
        status: 'simulated',
        metadata: built.metadata,
        gasUsed: simResult.gasEstimate,
      };
    }

    // Step 7: MEV protection
    if (signer === undefined) {
      return {
        status: 'error',
        error: 'Signer is required for non-watch-only execution',
      };
    }

    log.info({ protector: mevProtector.name }, 'Applying MEV protection');
    const protectedTx = await mevProtector.protect(txBytes, intent.chainId);

    // Step 8: Sign and submit
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

    // Step 9: Delegate event parsing and trade logging to the builder
    builder.finish?.({
      intent,
      status: 'approved',
      metadata: built.metadata,
      rawResponse: txResult.rawResponse,
      txDigest: txResult.txDigest,
      gasUsed: txResult.gasUsed,
    });

    log.info({ txDigest: txResult.txDigest, gasUsed: txResult.gasUsed }, 'Transaction succeeded');

    return {
      status: 'success',
      txDigest: txResult.txDigest,
      gasUsed: txResult.gasUsed,
      metadata: built.metadata,
    };
  } catch (err: unknown) {
    // Log the full error object so pino serializes .stack into the log file.
    // toErrorMessage() is only used for the user-facing output.
    log.error({ err }, 'Pipeline error');
    captureException(err);
    return {
      status: 'error',
      error: toErrorMessage(err),
    };
  }
}
