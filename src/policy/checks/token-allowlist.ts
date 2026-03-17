import type { PolicyCheck } from '../check.js';
import type { PolicyContext } from '../context.js';
import type { ActionIntent } from '../../core/action-types.js';
import type { CheckResult } from '../../types/result.js';

/**
 * Extract the trailing symbol from a fully-qualified Sui coin type.
 * e.g. "0x2::sui::SUI" -> "SUI"
 */
function extractTokenSymbol(coinType: string): string {
  const parts = coinType.split('::');
  return parts[parts.length - 1] ?? coinType;
}

/**
 * Policy check that verifies both the source and destination tokens
 * are present in the chain's configured allowlist.
 *
 * Only applies to swap intents. Non-swap actions pass automatically.
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

  evaluate(intent: ActionIntent, ctx: PolicyContext): Promise<CheckResult> {
    // Only swap intents need token allowlist checking
    if (intent.action !== 'swap') {
      return Promise.resolve({ status: 'pass' });
    }

    const allowlist = ctx.config.allowlist;

    if (allowlist === undefined) {
      return Promise.resolve({ status: 'pass' });
    }

    const allowedTokens = this.getAllowedSet(allowlist.tokens);

    const fromSymbol = extractTokenSymbol(intent.params.coinTypeIn);
    const fromTokenUpper = fromSymbol.toUpperCase();
    if (!allowedTokens.has(fromTokenUpper)) {
      return Promise.resolve({
        status: 'reject' as const,
        reason: 'token_not_allowed',
        detail: `Source token "${fromSymbol}" is not in the allowlist for chain "${intent.chain}"`,
        metadata: {
          token: fromSymbol,
          direction: 'from',
          allowedTokens: [...allowlist.tokens],
        },
      });
    }

    const toSymbol = extractTokenSymbol(intent.params.coinTypeOut);
    const toTokenUpper = toSymbol.toUpperCase();
    if (!allowedTokens.has(toTokenUpper)) {
      return Promise.resolve({
        status: 'reject' as const,
        reason: 'token_not_allowed',
        detail: `Destination token "${toSymbol}" is not in the allowlist for chain "${intent.chain}"`,
        metadata: {
          token: toSymbol,
          direction: 'to',
          allowedTokens: [...allowlist.tokens],
        },
      });
    }

    return Promise.resolve({ status: 'pass' as const });
  }
}
