import type { ActionIntent } from '../../core/action-types.js';
import type { CheckResult } from '../../types/result.js';
import { fromE9 } from '../../utils/bigint.js';
import { POLICY_PASS, type PolicyCheck } from '../check.js';
import type { PolicyContext } from '../context.js';

/**
 * Leverage cap check bounded by both config and on-chain max leverage.
 *
 * effectiveCap = min(config.max_leverage, ctx.perpMarketMaxLeverage)
 * If neither is set, the check passes (builder still validates on-chain).
 */
export class PerpLeverageCapCheck implements PolicyCheck {
  readonly name = 'perp_leverage_cap';
  readonly description = 'Enforces leverage cap bounded by config and on-chain max';

  evaluate(intent: ActionIntent, ctx: PolicyContext): Promise<CheckResult> {
    if (intent.action !== 'perp:place_order') {
      return Promise.resolve(POLICY_PASS);
    }

    // No explicit leverage in intent — auto-resolved by builder, check passes
    if (intent.params.leverageE9 === undefined) {
      return Promise.resolve(POLICY_PASS);
    }

    const configMax = ctx.config.perp?.max_leverage;

    // No config cap — check passes (builder validates on-chain)
    if (configMax === undefined && ctx.perpMarketMaxLeverage === undefined) {
      return Promise.resolve(POLICY_PASS);
    }

    const requestedLeverage = fromE9(intent.params.leverageE9);

    // Effective cap is the minimum of config and on-chain max.
    // At least one is defined (we returned early if both undefined).
    const caps: number[] = [];
    if (configMax !== undefined) caps.push(configMax);
    if (ctx.perpMarketMaxLeverage !== undefined) caps.push(ctx.perpMarketMaxLeverage);
    const effectiveCap = Math.min(...caps);

    if (requestedLeverage > effectiveCap) {
      const source =
        configMax !== undefined && effectiveCap === configMax ? 'config' : 'on-chain max';
      return Promise.resolve({
        status: 'reject',
        reason: 'exceeds_leverage_cap',
        detail:
          `Requested leverage ${String(requestedLeverage)}x exceeds ` +
          `effective cap of ${String(effectiveCap)}x (${source})`,
        metadata: {
          requested: requestedLeverage,
          effectiveCap,
          configMax,
          onChainMax: ctx.perpMarketMaxLeverage,
        },
      });
    }

    return Promise.resolve(POLICY_PASS);
  }
}
