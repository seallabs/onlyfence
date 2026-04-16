/**
 * IntentResolver: strategy pattern for action-specific intent resolution.
 *
 * Each resolver knows how to transform raw CLI inputs (token symbols,
 * human-readable amounts) into canonical, pipeline-ready intents
 * (coin types, smallest-unit amounts, market IDs, USD values).
 *
 * Resolvers are shared between InProcessActionExecutor and DaemonExecutor —
 * the only difference between execution modes is the signer source.
 */

import type { ChainAdapter } from '../chain/adapter.js';
import type { DataProvider } from './data-provider.js';
import type { ActionIntent, ActivityAction } from './action-types.js';
import type { PerpProviderRegistry } from './perp-provider.js';

/** Function type for resolving a lending market ID from a coin type. */
export type MarketResolverFn = (coinType: string, explicitMarketId?: string) => Promise<string>;

/**
 * Protocol-specific services injected into resolvers.
 *
 * Add new optional fields here when new protocols are integrated.
 * This keeps the services bag type-safe without string-key lookups.
 */
export interface ResolverServices {
  /** Per-chain market resolvers keyed by chain name (e.g., "sui", "solana", "ethereum"). */
  readonly marketResolvers: ReadonlyMap<string, MarketResolverFn>;
  readonly perpProviders?: PerpProviderRegistry | undefined;
}

/**
 * Dependencies injected into resolvers at resolution time.
 */
export interface ResolverDeps {
  readonly chainAdapter: ChainAdapter;
  readonly dataProvider: DataProvider;
  readonly walletAddress: string;
  readonly services: ResolverServices;
}

/** Result of resolving a raw intent into a pipeline-ready intent. */
export interface ResolvedExecution {
  readonly intent: ActionIntent;
  readonly tradeValueUsd?: number;
  /** Last traded price (USD) — set by perp resolvers to avoid redundant API calls. */
  readonly perpMarketPrice?: number;
  /** On-chain max leverage — set by perp resolvers to avoid redundant API calls. */
  readonly perpMarketMaxLeverage?: number;
}

/**
 * Resolves raw CLI inputs within an ActionIntent into canonical values.
 *
 * Implement this interface for each action category (trade, lending, etc.)
 * and register it with IntentResolverRegistry.
 */
export interface IntentResolver {
  /** Action types this resolver handles. */
  readonly supportedActions: readonly ActivityAction[];

  /**
   * Resolve raw intent fields into canonical, pipeline-ready values.
   *
   * @param rawIntent - Intent with raw CLI inputs (symbols, human amounts)
   * @param deps - Shared dependencies for resolution
   * @returns Resolved intent + USD value for policy checks
   */
  resolve(rawIntent: ActionIntent, deps: ResolverDeps): Promise<ResolvedExecution>;
}

/**
 * Registry mapping ActivityAction → IntentResolver.
 *
 * Follows the same pattern as ActionBuilderRegistry: register once,
 * look up by action type at execution time.
 */
export class IntentResolverRegistry {
  private readonly resolvers = new Map<ActivityAction, IntentResolver>();

  /** Register a resolver for its supported action types. */
  register(resolver: IntentResolver): void {
    for (const action of resolver.supportedActions) {
      if (this.resolvers.has(action)) {
        throw new Error(`IntentResolverRegistry: action "${action}" is already registered`);
      }
      this.resolvers.set(action, resolver);
    }
  }

  /** Look up a resolver by action type. Throws if none registered. */
  get(action: ActivityAction): IntentResolver {
    const resolver = this.resolvers.get(action);
    if (resolver === undefined) {
      throw new Error(`IntentResolverRegistry: no resolver registered for action "${action}"`);
    }
    return resolver;
  }

  /** Check if a resolver exists for the given action. */
  has(action: ActivityAction): boolean {
    return this.resolvers.has(action);
  }
}
