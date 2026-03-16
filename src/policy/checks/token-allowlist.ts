import type { PolicyCheck } from '../check.js';
import type { PolicyContext } from '../context.js';
import type { TradeIntent } from '../../types/intent.js';
import type { CheckResult } from '../../types/result.js';

/**
 * Policy check that verifies both the source and destination tokens
 * are present in the chain's configured allowlist.
 *
 * If no allowlist config is defined for the chain, the check passes
 * (config-driven loading per spec section 2.3).
 */
export class TokenAllowlistCheck implements PolicyCheck {
  readonly name = 'token_allowlist';
  readonly description = 'Verifies that both trade tokens are in the chain allowlist';

  async evaluate(intent: TradeIntent, ctx: PolicyContext): Promise<CheckResult> {
    const allowlist = ctx.config.allowlist;

    if (!allowlist) {
      return { status: 'pass' };
    }

    // Note: The Set is rebuilt on each call because ctx.config may differ per
    // invocation. For MVP-sized token lists this is acceptable. If performance
    // becomes an issue with very large allowlists, consider caching per config identity.
    const allowedTokens = new Set(allowlist.tokens.map((t) => t.toUpperCase()));

    const fromTokenUpper = intent.fromToken.toUpperCase();
    if (!allowedTokens.has(fromTokenUpper)) {
      return {
        status: 'reject',
        reason: 'token_not_allowed',
        detail: `Source token "${intent.fromToken}" is not in the allowlist for chain "${intent.chain}"`,
        metadata: {
          token: intent.fromToken,
          direction: 'from',
          allowedTokens: [...allowlist.tokens],
        },
      };
    }

    const toTokenUpper = intent.toToken.toUpperCase();
    if (!allowedTokens.has(toTokenUpper)) {
      return {
        status: 'reject',
        reason: 'token_not_allowed',
        detail: `Destination token "${intent.toToken}" is not in the allowlist for chain "${intent.chain}"`,
        metadata: {
          token: intent.toToken,
          direction: 'to',
          allowedTokens: [...allowlist.tokens],
        },
      };
    }

    return { status: 'pass' };
  }
}
