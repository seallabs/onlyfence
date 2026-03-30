import type { ActionIntent } from '../../core/action-types.js';
import type { CheckResult } from '../../types/result.js';
import { POLICY_PASS, type PolicyCheck } from '../check.js';
import type { PolicyContext } from '../context.js';

/**
 * Resolves a token alias or raw coin type to its canonical address.
 * Returns undefined if the input cannot be resolved (unknown token).
 */
type AddressResolver = (symbolOrAddress: string) => string | undefined;

/**
 * Policy check that verifies both the source and destination tokens
 * are present in the chain's configured allowlist.
 *
 * Compares canonical coin type addresses (not symbols) to avoid
 * false-positive matches from ambiguous struct names.
 *
 * Only applies to swap and supply intents. Non-applicable actions pass automatically.
 * If no allowlist config is defined for the chain, the check passes
 * (config-driven loading per spec section 2.3).
 */
export class TokenAllowlistCheck implements PolicyCheck {
  readonly name = 'token_allowlist';
  readonly description = 'Verifies that both trade tokens are in the chain allowlist';
  private readonly addressResolver: AddressResolver;

  constructor(addressResolver: AddressResolver) {
    this.addressResolver = addressResolver;
  }

  private cache: { ref: readonly string[]; set: Set<string> } | null = null;

  /**
   * Build a set of canonical coin type addresses from the allowlist aliases.
   * Unresolvable aliases are kept as-is (uppercased) for backwards compatibility.
   * Cached by token array reference — invalidates when config is reloaded.
   */
  private getAllowedAddresses(tokens: readonly string[]): Set<string> {
    if (this.cache?.ref !== tokens) {
      const addresses = new Set<string>();
      for (const t of tokens) {
        const resolved = this.addressResolver(t);
        if (resolved !== undefined) {
          addresses.add(resolved);
        }
      }
      this.cache = { ref: tokens, set: addresses };
    }
    return this.cache.set;
  }

  evaluate(intent: ActionIntent, ctx: PolicyContext): Promise<CheckResult> {
    if (intent.action === 'lending:claim_rewards') {
      return Promise.resolve(POLICY_PASS);
    }

    const allowlist = ctx.config.allowlist;

    if (allowlist === undefined) {
      return Promise.resolve(POLICY_PASS);
    }

    const allowedAddresses = this.getAllowedAddresses(allowlist.tokens);

    // Swap intents: check both source and destination tokens
    if (intent.action === 'trade:swap') {
      if (!allowedAddresses.has(intent.params.coinTypeIn)) {
        return Promise.resolve({
          status: 'reject' as const,
          reason: 'token_not_allowed',
          detail: `Source token "${intent.params.coinTypeIn}" is not in the allowlist for chain "${intent.chainId}"`,
          metadata: {
            token: intent.params.coinTypeIn,
            direction: 'from',
            allowedTokens: [...allowlist.tokens],
          },
        });
      }

      if (!allowedAddresses.has(intent.params.coinTypeOut)) {
        return Promise.resolve({
          status: 'reject' as const,
          reason: 'token_not_allowed',
          detail: `Destination token "${intent.params.coinTypeOut}" is not in the allowlist for chain "${intent.chainId}"`,
          metadata: {
            token: intent.params.coinTypeOut,
            direction: 'to',
            allowedTokens: [...allowlist.tokens],
          },
        });
      }

      return Promise.resolve(POLICY_PASS);
    }

    // Perp cancel/withdraw: no token to check
    if (intent.action === 'perp:cancel_order' || intent.action === 'perp:withdraw') {
      return Promise.resolve(POLICY_PASS);
    }

    // Perp place order: check collateral coin type
    if (intent.action === 'perp:place_order') {
      if (!allowedAddresses.has(intent.params.collateralCoinType)) {
        return Promise.resolve({
          status: 'reject' as const,
          reason: 'token_not_allowed',
          detail: `Collateral token "${intent.params.collateralCoinType}" is not in the allowlist for chain "${intent.chainId}"`,
          metadata: {
            token: intent.params.collateralCoinType,
            allowedTokens: [...allowlist.tokens],
          },
        });
      }
      return Promise.resolve(POLICY_PASS);
    }

    // Remaining actions (supply, borrow, withdraw, repay, deposit): single coinType check
    if (!allowedAddresses.has(intent.params.coinType)) {
      return Promise.resolve({
        status: 'reject' as const,
        reason: 'token_not_allowed',
        detail: `Token "${intent.params.coinType}" is not in the allowlist for chain "${intent.chainId}"`,
        metadata: {
          token: intent.params.coinType,
          allowedTokens: [...allowlist.tokens],
        },
      });
    }

    return Promise.resolve(POLICY_PASS);
  }
}
