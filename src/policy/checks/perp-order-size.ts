import type { ActionIntent } from '../../core/action-types.js';
import type { CheckResult } from '../../types/result.js';
import { POLICY_PASS, policyPassSkipped, type PolicyCheck } from '../check.js';
import type { PolicyContext } from '../context.js';

/**
 * Per-order notional USD size limit for perp orders.
 *
 * Uses ctx.tradeValueUsd which is pre-computed during context resolution.
 * If trade value is unavailable, the check passes with a warning
 * (permissive — price unavailability should not block trading).
 */
export class PerpOrderSizeCheck implements PolicyCheck {
  readonly name = 'perp_order_size';
  readonly description = 'Enforces per-order notional USD limit for perp orders';

  evaluate(intent: ActionIntent, ctx: PolicyContext): Promise<CheckResult> {
    if (intent.action !== 'perp:place_order') {
      return Promise.resolve(POLICY_PASS);
    }

    const maxSingleOrder = ctx.config.perp?.max_single_order;
    if (maxSingleOrder === undefined) {
      return Promise.resolve(POLICY_PASS);
    }

    const notional = ctx.tradeValueUsd;
    if (notional === undefined) {
      return Promise.resolve(policyPassSkipped('trade_value_unavailable'));
    }

    if (notional > maxSingleOrder) {
      return Promise.resolve({
        status: 'reject',
        reason: 'exceeds_single_order_limit',
        detail:
          `Order notional $${notional.toFixed(2)} exceeds ` +
          `max single order limit of $${maxSingleOrder.toFixed(2)}`,
        metadata: {
          limit: maxSingleOrder,
          notional,
        },
      });
    }

    return Promise.resolve(POLICY_PASS);
  }
}
