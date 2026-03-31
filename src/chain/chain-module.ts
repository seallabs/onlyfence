import type Database from 'better-sqlite3';
import type { ChainConfig } from '../types/config.js';
import type { ChainAdapterFactory } from './factory.js';
import type { ActionBuilderRegistry } from '../core/action-builder.js';
import type { DataProviderRegistry } from '../core/data-provider.js';
import type { MevProtector } from '../core/mev-protector.js';
import type { PerpProviderRegistry } from '../core/perp-provider.js';
import type { PolicyCheckRegistry } from '../policy/registry.js';
import type { ActivityLog } from '../db/activity-log.js';
import type { CoinMetadataRepository } from '../db/coin-metadata-repo.js';
import type { KeyDeriver, KeyDeriverRegistry } from '../wallet/key-deriver.js';
import type { SignerRegistry } from '../wallet/signer-registry.js';
import type { LPProService } from '../data/lp-pro-service.js';
import type { MarketResolverFn } from '../core/intent-resolver.js';

/**
 * Describes a credential that a chain module requires to operate.
 *
 * Each chain declares its own credential requirements. During setup, the wizard
 * checks env vars first, then prompts interactively if missing.
 */
export interface CredentialRequirement {
  /** Credential identifier, used as the key in config credentials section. */
  readonly name: string;

  /** Human-readable description for the setup wizard prompt. */
  readonly description: string;

  /** Environment variable name to check as a fallback (e.g., "SOLANA_RPC_API_KEY"). */
  readonly envVar: string;

  /** Whether this credential is required for the chain to function. */
  readonly required: boolean;
}

/**
 * Static metadata about a chain module, available before registration.
 *
 * Used by the setup wizard to display chain options and collect credentials.
 */
export interface ChainModuleInfo {
  /** Chain identifier (must match the Chain union type, e.g., "sui"). */
  readonly chain: string;

  /** Human-readable display name (e.g., "Sui", "Solana"). */
  readonly displayName: string;

  /** Default public RPC endpoint, if one exists. */
  readonly defaultRpc?: string;

  /** Default network (e.g., "mainnet"). Defaults to "mainnet" if omitted. */
  readonly defaultNetwork?: string;

  /** Credentials this chain requires (API keys, etc.). Empty if none needed. */
  readonly credentialRequirements: readonly CredentialRequirement[];

  /**
   * Default chain config used during setup.
   * Includes RPC, allowlist, limits, etc. appropriate for the chain.
   */
  readonly defaultChainConfig: ChainConfig;
}

/**
 * Context passed to a ChainModule during registration.
 *
 * Contains all registries and shared services the module needs to populate.
 */
export interface ChainRegistrationContext {
  /** Per-chain configuration from config.toml. */
  readonly config: ChainConfig;

  /** Database connection. */
  readonly db: Database.Database;

  /** Activity log for builders that log trade results. */
  readonly activityLog: ActivityLog;

  /** Coin metadata cache repository. */
  readonly coinMetadataRepo: CoinMetadataRepository;

  /** LP price data service. */
  readonly lpPro: LPProService;

  // ── Registries to populate ──────────────────────────────────────────────

  readonly chainAdapterFactory: ChainAdapterFactory;
  readonly dataProviders: DataProviderRegistry;
  readonly actionBuilderRegistry: ActionBuilderRegistry;
  readonly signerRegistry: SignerRegistry;
  readonly keyDeriverRegistry: KeyDeriverRegistry;
  readonly mevProtectors: Map<string, MevProtector>;
  readonly perpProviders: PerpProviderRegistry;
  readonly policyRegistry: PolicyCheckRegistry;

  /**
   * Register a market resolver for lending protocols.
   * Each chain can provide its own resolver (e.g., AlphaLend on Sui).
   */
  setMarketResolver(resolver: MarketResolverFn): void;
}

/**
 * A chain module encapsulates all chain-specific initialization logic.
 *
 * When a chain is configured in config.toml, bootstrap calls `register()`
 * which populates all shared registries (adapters, builders, signers, etc.)
 * with chain-specific implementations.
 *
 * New chains are added by implementing this interface and registering the
 * module in the ChainModuleRegistry — no changes to bootstrap needed.
 */
export interface ChainModule {
  /** Static metadata about this chain. */
  readonly info: ChainModuleInfo;

  /**
   * Create a KeyDeriver for this chain without full registration context.
   * Used during setup (wallet generation/import) before full bootstrap.
   */
  createKeyDeriver(): KeyDeriver;

  /**
   * Register all chain-specific components into the shared registries.
   *
   * Called once during bootstrap for each configured chain.
   */
  register(ctx: ChainRegistrationContext): void;

  /**
   * Clean up SDK clients, timers, and other resources.
   * Called during graceful shutdown. Safe to call multiple times.
   */
  dispose?(): Promise<void>;
}
