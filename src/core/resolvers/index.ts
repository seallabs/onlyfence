/**
 * Barrel export for intent resolvers + factory to build the registry.
 */

import { IntentResolverRegistry } from '../intent-resolver.js';
import { ClaimRewardsResolver } from './claim-rewards-resolver.js';
import { LendingIntentResolver } from './lending-resolver.js';
import { SwapIntentResolver } from './swap-resolver.js';

export { ClaimRewardsResolver } from './claim-rewards-resolver.js';
export { LendingIntentResolver } from './lending-resolver.js';
export { SwapIntentResolver } from './swap-resolver.js';

/**
 * Build an IntentResolverRegistry with all supported resolvers.
 *
 * New action types (LP, perp, staking) just need a new resolver
 * registered here — no executor changes required.
 */
export function buildIntentResolverRegistry(): IntentResolverRegistry {
  const registry = new IntentResolverRegistry();
  registry.register(new SwapIntentResolver());
  registry.register(new LendingIntentResolver());
  registry.register(new ClaimRewardsResolver());
  return registry;
}
