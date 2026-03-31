import type { ActionIntent } from '../../core/action-types.js';
import type { CheckResult } from '../../types/result.js';
import { POLICY_PASS, type PolicyCheck } from '../check.js';
import type { PolicyContext } from '../context.js';

/**
 * Default-deny market allowlist for perp operations.
 *
 * - Non-perp actions: pass through
 * - Cancel and withdraw: always allowed (risk-reducing)
 * - Deposit and place_order: perp must be enabled (non-empty allowlist)
 * - Place order: market must also be in allowlist
 */
export class PerpMarketAllowlistCheck implements PolicyCheck {
  readonly name = 'perp_market_allowlist';
  readonly description = 'Verifies perp market is in the configured allowlist (default-deny)';

  evaluate(intent: ActionIntent, ctx: PolicyContext): Promise<CheckResult> {
    if (!intent.action.startsWith('perp:')) {
      return Promise.resolve(POLICY_PASS);
    }

    if (intent.action === 'perp:cancel_order' || intent.action === 'perp:withdraw') {
      return Promise.resolve(POLICY_PASS);
    }

    const perpConfig = ctx.config.perp;
    const markets = perpConfig?.allowlist_markets;

    if (markets === undefined || markets.length === 0) {
      return Promise.resolve({
        status: 'reject',
        reason: 'perp_not_enabled',
        detail:
          'Perp trading is not enabled. Add a [chain.sui.perp] section with allowlist_markets to config.toml.',
      });
    }

    if (intent.action === 'perp:deposit') {
      return Promise.resolve(POLICY_PASS);
    }

    if (intent.action !== 'perp:place_order') {
      return Promise.resolve(POLICY_PASS);
    }

    const marketSymbol = intent.params.marketSymbol;
    if (!markets.includes(marketSymbol)) {
      return Promise.resolve({
        status: 'reject',
        reason: 'market_not_allowed',
        detail: `Market "${marketSymbol}" is not in the perp allowlist. Allowed: ${markets.join(', ')}`,
        metadata: {
          market: marketSymbol,
          allowedMarkets: [...markets],
        },
      });
    }

    return Promise.resolve(POLICY_PASS);
  }
}
