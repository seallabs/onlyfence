/**
 * ClaimRewardsResolver: pass-through resolver for claim_rewards.
 *
 * No token or market resolution needed — just fills in the wallet address.
 */

import type { ActivityAction, ClaimRewardsIntent } from '../action-types.js';
import type { IntentResolver, ResolvedExecution, ResolverDeps } from '../intent-resolver.js';

export class ClaimRewardsResolver implements IntentResolver {
  readonly supportedActions: readonly ActivityAction[] = ['lending:claim_rewards'];

  resolve(rawIntent: ClaimRewardsIntent, deps: ResolverDeps): Promise<ResolvedExecution> {
    const resolvedIntent: ClaimRewardsIntent = {
      ...rawIntent,
      walletAddress: deps.walletAddress,
    };
    return Promise.resolve({ intent: resolvedIntent });
  }
}
