import type { ActionIntent } from '../../core/action-types.js';
import type { CheckResult } from '../../types/result.js';
import { POLICY_PASS, policyPassSkipped, type PolicyCheck } from '../check.js';
import type { PolicyContext } from '../context.js';

// NOTE: Volume is counted from perp:place_order (intent), not perp:filled (actual fills).
// This is conservative — orders rejected by the exchange after pipeline approval still count.
// This avoids depending on `fence perp sync` being called for fill-based tracking.
// Trade-off: over-counts when exchange rejects orders, but safer than under-counting.

/**
 * Rolling 24-hour perp order volume limit.
 *
 * Checks whether projected volume (current rolling + this order's value)
 * exceeds the configured max_24h_volume for perp.
 */
export class PerpVolumeCheck implements PolicyCheck {
  readonly name = 'perp_volume';
  readonly description = 'Enforces rolling 24-hour perp volume limit';

  evaluate(intent: ActionIntent, ctx: PolicyContext): Promise<CheckResult> {
    if (intent.action !== 'perp:place_order') {
      return Promise.resolve(POLICY_PASS);
    }

    const maxVolume = ctx.config.perp?.max_24h_volume;
    if (maxVolume === undefined) {
      return Promise.resolve(POLICY_PASS);
    }

    if (ctx.tradeValueUsd === undefined) {
      return Promise.resolve(policyPassSkipped('trade_value_unavailable'));
    }

    const current = ctx.activityLog.getRolling24hPerpVolume(intent.chainId);
    const projected = current + ctx.tradeValueUsd;

    if (projected > maxVolume) {
      return Promise.resolve({
        status: 'reject',
        reason: 'exceeds_24h_perp_volume',
        detail:
          `24h perp volume $${current.toFixed(2)} + $${ctx.tradeValueUsd.toFixed(2)} = ` +
          `$${projected.toFixed(2)} exceeds limit of $${maxVolume.toFixed(2)}`,
        metadata: {
          limit: maxVolume,
          current,
          requested: ctx.tradeValueUsd,
          projected,
        },
      });
    }

    return Promise.resolve(POLICY_PASS);
  }
}
