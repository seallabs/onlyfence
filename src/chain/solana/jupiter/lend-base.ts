import type { FinishContext } from '../../../core/action-builder.js';
import type { ActivityAction, TokenLendingIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';

/**
 * Shared finish() implementation for all Jupiter Lend builders.
 * Logs the lending activity to the activity log.
 */
export function finishJupiterLendActivity(
  activityLog: ActivityLog,
  context: FinishContext,
  action: ActivityAction,
): void {
  const intent = context.intent as TokenLendingIntent;
  activityLog.logActivity({
    chain_id: intent.chainId,
    wallet_address: intent.walletAddress,
    action,
    protocol: 'jupiter_lend',
    token_a_type: intent.params.coinType,
    token_a_amount: intent.params.amount,
    value_usd: intent.valueUsd ?? undefined,
    tx_digest: context.txDigest ?? undefined,
    gas_cost: context.gasUsed ?? undefined,
    policy_decision: context.status,
    rejection_reason: context.rejection?.reason ?? undefined,
    rejection_check: context.rejection?.check ?? undefined,
  });
}
