import type { ActionIntent } from '../../core/action-types.js';
import type { CheckResult } from '../../types/result.js';
import { POLICY_PASS, policyPassSkipped, type PolicyCheck } from '../check.js';
import type { PolicyContext } from '../context.js';

/**
 * Rolling 24-hour perp withdrawal limit.
 *
 * Checks whether projected withdrawals (current rolling + this withdrawal's value)
 * exceeds the configured max_24h_withdraw for perp.
 */
export class PerpWithdrawLimitCheck implements PolicyCheck {
  readonly name = 'perp_withdraw_limit';
  readonly description = 'Enforces rolling 24-hour perp withdrawal limit';

  evaluate(intent: ActionIntent, ctx: PolicyContext): Promise<CheckResult> {
    if (intent.action !== 'perp:withdraw') {
      return Promise.resolve(POLICY_PASS);
    }

    const maxWithdraw = ctx.config.perp?.max_24h_withdraw;
    if (maxWithdraw === undefined) {
      return Promise.resolve(POLICY_PASS);
    }

    if (ctx.tradeValueUsd === undefined) {
      return Promise.resolve(policyPassSkipped('trade_value_unavailable'));
    }

    const current = ctx.activityLog.getRolling24hPerpWithdrawals(intent.chainId);
    const projected = current + ctx.tradeValueUsd;

    if (projected > maxWithdraw) {
      return Promise.resolve({
        status: 'reject',
        reason: 'exceeds_24h_perp_withdraw',
        detail:
          `24h perp withdrawals $${current.toFixed(2)} + $${ctx.tradeValueUsd.toFixed(2)} = ` +
          `$${projected.toFixed(2)} exceeds limit of $${maxWithdraw.toFixed(2)}`,
        metadata: {
          limit: maxWithdraw,
          current,
          requested: ctx.tradeValueUsd,
          projected,
        },
      });
    }

    return Promise.resolve(POLICY_PASS);
  }
}
