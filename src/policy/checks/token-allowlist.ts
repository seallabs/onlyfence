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

  private cache: { ref: readonly string[]; set: Set<string> } | null = null;

  /**
   * Get or build the uppercased token set, cached by token array reference.
   * Cache invalidates automatically when config is reloaded (new array reference).
   */
  private getAllowedSet(tokens: readonly string[]): Set<string> {
    if (this.cache?.ref !== tokens) {
      this.cache = { ref: tokens, set: new Set(tokens.map((t) => t.toUpperCase())) };
    }
    return this.cache.set;
  }

  evaluate(intent: TradeIntent, ctx: PolicyContext): Promise<CheckResult> {
    const allowlist = ctx.config.allowlist;

    if (allowlist === undefined) {
      return Promise.resolve({ status: 'pass' });
    }

    const allowedTokens = this.getAllowedSet(allowlist.tokens);

    const fromTokenUpper = intent.fromToken.toUpperCase();
    if (!allowedTokens.has(fromTokenUpper)) {
      return Promise.resolve({
        status: 'reject' as const,
        reason: 'token_not_allowed',
        detail: `Source token "${intent.fromToken}" is not in the allowlist for chain "${intent.chain}"`,
        metadata: {
          token: intent.fromToken,
          direction: 'from',
          allowedTokens: [...allowlist.tokens],
        },
      });
    }

    const toTokenUpper = intent.toToken.toUpperCase();
    if (!allowedTokens.has(toTokenUpper)) {
      return Promise.resolve({
        status: 'reject' as const,
        reason: 'token_not_allowed',
        detail: `Destination token "${intent.toToken}" is not in the allowlist for chain "${intent.chain}"`,
        metadata: {
          token: intent.toToken,
          direction: 'to',
          allowedTokens: [...allowlist.tokens],
        },
      });
    }

    return Promise.resolve({ status: 'pass' as const });
  }
}
