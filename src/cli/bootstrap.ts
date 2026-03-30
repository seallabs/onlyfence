import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import { ChainAdapterFactory } from '../chain/factory.js';
import { buildChainRegistry, type ChainRegistry } from '../chain/registry.js';
import { bootstrapSuiChain } from '../chain/sui/bootstrap.js';
import { resolveMarketId } from '../chain/sui/alphalend/markets.js';
import { tryResolveTokenAddress } from '../chain/sui/tokens.js';
import { getChainConfig } from '../config/utils.js';
import { CONFIG_PATH, loadConfig } from '../config/loader.js';
import { ActionBuilderRegistry } from '../core/action-builder.js';
import type { IntentResolverRegistry, ResolverServices } from '../core/intent-resolver.js';
import { buildIntentResolverRegistry } from '../core/resolvers/index.js';
import { DataProviderRegistry } from '../core/data-provider.js';
import { type MevProtector, NoOpMevProtector } from '../core/mev-protector.js';
import { LPProService } from '../data/lp-pro-service.js';
import { ActivityLog } from '../db/activity-log.js';
import { CliEventLog } from '../db/cli-events.js';
import { DB_PATH, openDatabase } from '../db/connection.js';
import { getLogger } from '../logger/index.js';
import { SpendingLimitCheck } from '../policy/checks/spending-limit.js';
import { TokenAllowlistCheck } from '../policy/checks/token-allowlist.js';
import { PolicyCheckRegistry } from '../policy/registry.js';
import { initSentry } from '../telemetry/sentry.js';
import type { AppConfig } from '../types/config.js';
import type { Signer } from '../types/result.js';

/**
 * All initialized application components returned by bootstrap.
 */
export interface AppComponents {
  readonly db: Database.Database;
  readonly config: AppConfig;
  readonly chainRegistry: ChainRegistry;
  readonly dataProviders: DataProviderRegistry;
  readonly activityLog: ActivityLog;
  readonly alphalendClient: AlphalendClient;
  readonly cliEventLog: CliEventLog;
  readonly policyRegistry: PolicyCheckRegistry;
  readonly chainAdapterFactory: ChainAdapterFactory;
  readonly actionBuilderRegistry: ActionBuilderRegistry;
  readonly intentResolverRegistry: IntentResolverRegistry;
  readonly mevProtectors: Map<string, MevProtector>;
  /** Chain-aware signer factory: builds a Signer from chain ID and raw key bytes. */
  readonly buildSigner: (chainId: string, keyBytes: Uint8Array) => Signer;
  /** Protocol-specific services for intent resolvers. */
  readonly resolverServices: ResolverServices;
  readonly logger: Logger;

  /** Close the database and release resources. Safe to call multiple times. */
  close(): void;
}

/**
 * Bootstrap the OnlyFence application by initializing all core components.
 *
 * Chain initialization is config-driven: only chains present in `config.chain`
 * are bootstrapped. Adding a new chain requires:
 * 1. A ChainDefinition in the registry
 * 2. A bootstrapXChain() function in src/chain/x/bootstrap.ts
 * 3. A `[chain.x]` section in config.toml
 *
 * @param options - Optional overrides for paths
 * @returns Fully initialized AppComponents
 * @throws Error if DB or config initialization fails
 */
export function bootstrap(options?: { dbPath?: string; configPath?: string }): AppComponents {
  const db = openDatabase(options?.dbPath ?? DB_PATH);
  const config = loadConfig(options?.configPath ?? CONFIG_PATH);
  const logger = getLogger();
  const chainRegistry = buildChainRegistry();

  // Initialize Sentry if telemetry is configured and enabled
  initSentry(config.telemetry?.enabled ?? false);

  const lpPro = new LPProService();
  const dataProviders = new DataProviderRegistry();
  const activityLog = new ActivityLog(db);
  const cliEventLog = new CliEventLog(db);
  const policyRegistry = buildPolicyRegistry(config);
  const chainAdapterFactory = new ChainAdapterFactory();
  const actionBuilderRegistry = new ActionBuilderRegistry();
  const mevProtectors = new Map<string, MevProtector>();
  const intentResolverRegistry = buildIntentResolverRegistry();

  // Bootstrap each configured chain
  let alphalendClient: AlphalendClient | undefined;

  for (const chainName of Object.keys(config.chain)) {
    const chainConfig = getChainConfig(config, chainName);

    if (chainName === 'sui') {
      const suiResult = bootstrapSuiChain(chainConfig, db, lpPro, activityLog, {
        chainAdapterFactory,
        dataProviders,
        actionBuilderRegistry,
        mevProtectors,
      });
      alphalendClient = suiResult.alphalendClient;
    }
  }

  // Fallback MEV protector for unconfigured chains
  if (!mevProtectors.has('default')) {
    mevProtectors.set('default', new NoOpMevProtector());
  }

  // Chain-aware signer factory using the registry
  const buildSigner = (chainId: string, keyBytes: Uint8Array): Signer => {
    const chainDef = chainRegistry.getByChainId(chainId);
    return chainDef.walletDerivation.buildSigner(keyBytes);
  };

  // Build resolver services (AlphaLend market resolver is Sui-specific)
  const resolverServices: ResolverServices = {
    marketResolver:
      alphalendClient !== undefined
        ? (coinType: string, explicitMarketId?: string) =>
            resolveMarketId(alphalendClient, coinType, explicitMarketId)
        : (_coinType: string, _explicitMarketId?: string) => {
            throw new Error('AlphaLend is not available: Sui chain is not configured');
          },
  };

  let closed = false;

  function close(): void {
    if (closed) return;
    closed = true;
    try {
      db.close();
    } catch (err: unknown) {
      logger.warn({ err }, 'Error closing database');
    }
  }

  logger.info('Bootstrap complete');

  // alphalendClient is guaranteed to exist if Sui is configured
  // For backwards compatibility, provide a stub that throws if Sui is not configured
  const alphalendClientOrStub =
    alphalendClient ??
    (new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (typeof prop === 'string') {
            return () => {
              throw new Error('AlphaLend is not available: Sui chain is not configured');
            };
          }
          return undefined;
        },
      },
    ) as AlphalendClient);

  return {
    db,
    config,
    chainRegistry,
    dataProviders,
    activityLog,
    alphalendClient: alphalendClientOrStub,
    cliEventLog,
    policyRegistry,
    chainAdapterFactory,
    actionBuilderRegistry,
    intentResolverRegistry,
    mevProtectors,
    buildSigner,
    resolverServices,
    logger,
    close,
  };
}

/**
 * Build a policy registry with all MVP checks registered.
 *
 * Each check already handles missing config gracefully (returns pass
 * when its config section is absent), so we always register all checks
 * rather than conditionally based on config presence.
 *
 * @param _config - Application configuration (reserved for future use)
 * @returns PolicyCheckRegistry with all MVP checks registered
 */
export function buildPolicyRegistry(_config: AppConfig): PolicyCheckRegistry {
  const registry = new PolicyCheckRegistry();

  registry.register(new TokenAllowlistCheck(tryResolveTokenAddress));
  registry.register(new SpendingLimitCheck());

  return registry;
}
