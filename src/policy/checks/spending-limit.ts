import type { PolicyCheck } from '../check.js';
import type { PolicyContext } from '../context.js';
import type { TradeIntent } from '../../types/intent.js';
import type { CheckResult } from '../../types/result.js';

/**
 * Policy check that enforces per-trade and rolling 24-hour spending limits.
 *
 * Requires USD value of the trade (from PolicyContext.tradeValueUsd or oracle).
 * If limits config is missing, the check passes (config-driven loading).
 * If oracle failed (tradeValueUsd is undefined), the check passes
 * (per spec section 10 - oracle failure means USD limits unenforced).
 */
export class SpendingLimitCheck implements PolicyCheck {
  readonly name = 'spending_limit';
  readonly description = 'Enforces per-trade and rolling 24-hour USD spending limits';

  evaluate(intent: TradeIntent, ctx: PolicyContext): Promise<CheckResult> {
    const limits = ctx.config.limits;

    if (limits === undefined) {
      return Promise.resolve({ status: 'pass' });
    }

    if (ctx.tradeValueUsd === undefined) {
      return Promise.resolve({
        status: 'pass',
        metadata: {
          skipped: true,
          reason: 'oracle_price_unavailable',
        },
      });
    }

    const tradeValueUsd = ctx.tradeValueUsd;

    if (tradeValueUsd > limits.max_single_trade) {
      return Promise.resolve({
        status: 'reject',
        reason: 'exceeds_single_trade_limit',
        detail:
          `Trade value $${tradeValueUsd.toFixed(2)} exceeds ` +
          `max single trade limit of $${limits.max_single_trade.toFixed(2)}`,
        metadata: {
          limit: limits.max_single_trade,
          requested: tradeValueUsd,
        },
      });
    }

    const rolling24h = ctx.tradeLog.getRolling24hVolume(intent.chain);

    const projectedVolume = rolling24h + tradeValueUsd;
    if (projectedVolume > limits.max_24h_volume) {
      return Promise.resolve({
        status: 'reject',
        reason: 'exceeds_24h_volume',
        detail:
          `24h volume $${rolling24h.toFixed(2)} + $${tradeValueUsd.toFixed(2)} = ` +
          `$${projectedVolume.toFixed(2)} exceeds limit of $${limits.max_24h_volume.toFixed(2)}`,
        metadata: {
          limit: limits.max_24h_volume,
          current: rolling24h,
          requested: tradeValueUsd,
        },
      });
    }

    return Promise.resolve({ status: 'pass' });
  }
}
