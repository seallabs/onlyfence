import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type { ChainRegistrationContext } from '../chain/chain-module.js';
import { ChainAdapterFactory } from '../chain/factory.js';
import { ChainModuleRegistry } from '../chain/module-registry.js';
import { SolanaChainModule } from '../chain/solana/module.js';
import { SuiChainModule } from '../chain/sui/module.js';
import { CONFIG_PATH, loadConfig } from '../config/loader.js';
import { ActionBuilderRegistry } from '../core/action-builder.js';
import type {
  IntentResolverRegistry,
  MarketResolverFn,
  ResolverServices,
} from '../core/intent-resolver.js';
import { buildIntentResolverRegistry } from '../core/resolvers/index.js';
import { DataProviderRegistry } from '../core/data-provider.js';
import type { MevProtector } from '../core/mev-protector.js';
import { PerpProviderRegistry } from '../core/perp-provider.js';
import { LPProService } from '../data/lp-pro-service.js';
import { ActivityLog } from '../db/activity-log.js';
import { CliEventLog } from '../db/cli-events.js';
import { CoinMetadataRepository } from '../db/coin-metadata-repo.js';
import { DB_PATH, openDatabase } from '../db/connection.js';
import { getLogger } from '../logger/index.js';
import { PerpLeverageCapCheck } from '../policy/checks/perp-leverage-cap.js';
import { PerpMarketAllowlistCheck } from '../policy/checks/perp-market-allowlist.js';
import { PerpOrderSizeCheck } from '../policy/checks/perp-order-size.js';
import { PerpVolumeCheck } from '../policy/checks/perp-volume.js';
import { PerpWithdrawLimitCheck } from '../policy/checks/perp-withdraw-limit.js';
import { SpendingLimitCheck } from '../policy/checks/spending-limit.js';
import { PolicyCheckRegistry } from '../policy/registry.js';
import { initSentry } from '../telemetry/sentry.js';
import type { AppConfig } from '../types/config.js';
import { KeyDeriverRegistry } from '../wallet/key-deriver.js';
import { SignerRegistry } from '../wallet/signer-registry.js';

/**
 * All initialized application components returned by bootstrap.
 */
export interface AppComponents {
  readonly db: Database.Database;
  readonly config: AppConfig;
  readonly dataProviders: DataProviderRegistry;
  readonly activityLog: ActivityLog;
  readonly coinMetadataRepo: CoinMetadataRepository;
  /** Protocol-abstract perp provider registry. */
  readonly perpProviders: PerpProviderRegistry;
  readonly cliEventLog: CliEventLog;
  readonly policyRegistry: PolicyCheckRegistry;
  readonly chainAdapterFactory: ChainAdapterFactory;
  readonly actionBuilderRegistry: ActionBuilderRegistry;
  readonly intentResolverRegistry: IntentResolverRegistry;
  readonly mevProtectors: Map<string, MevProtector>;
  /** Chain-agnostic signer registry: builds a Signer from chainId + raw key bytes. */
  readonly signerRegistry: SignerRegistry;
  /** Protocol-specific services for intent resolvers. */
  readonly resolverServices: ResolverServices;
  /** Registry of initialized chain modules (for lifecycle management and chain-specific access). */
  readonly chainModules: ChainModuleRegistry;
  readonly logger: Logger;

  /** Close the database, dispose SDK clients, and release resources. Safe to call multiple times. */
  close(): Promise<void>;
}

/**
 * Bootstrap the OnlyFence application by initializing all core components.
 *
 * Steps:
 * 1. Open/create SQLite DB and run migrations
 * 2. Load config from TOML
 * 3. Initialize Sentry if telemetry is enabled
 * 4. Create empty registries
 * 5. Register chain modules for each configured chain
 * 6. Register generic policy checks
 * 7. Build resolver services
 *
 * @param options - Optional overrides for paths
 * @returns Fully initialized AppComponents
 * @throws Error if DB or config initialization fails
 */
export function bootstrap(options?: { dbPath?: string; configPath?: string }): AppComponents {
  const db = openDatabase(options?.dbPath ?? DB_PATH);
  const config = loadConfig(options?.configPath ?? CONFIG_PATH);
  const logger = getLogger();

  // Initialize Sentry if telemetry is configured and enabled
  initSentry(config.telemetry?.enabled ?? false);

  // Create shared services
  const lpPro = new LPProService();
  const coinMetadataRepo = new CoinMetadataRepository(db);
  const activityLog = new ActivityLog(db);
  const cliEventLog = new CliEventLog(db);

  // Create empty registries — chain modules will populate them
  const chainAdapterFactory = new ChainAdapterFactory();
  const dataProviders = new DataProviderRegistry();
  const actionBuilderRegistry = new ActionBuilderRegistry();
  const signerRegistry = new SignerRegistry();
  const keyDeriverRegistry = new KeyDeriverRegistry();
  const mevProtectors = new Map<string, MevProtector>();
  const perpProviders = new PerpProviderRegistry();
  const policyRegistry = new PolicyCheckRegistry();

  // Register generic (chain-agnostic) policy checks
  policyRegistry.register(new SpendingLimitCheck());
  policyRegistry.register(new PerpMarketAllowlistCheck());
  policyRegistry.register(new PerpLeverageCapCheck());
  policyRegistry.register(new PerpOrderSizeCheck());
  policyRegistry.register(new PerpVolumeCheck());
  policyRegistry.register(new PerpWithdrawLimitCheck());

  // Build chain module registry with all available chain modules
  const chainModules = buildChainModuleRegistry();

  // Mutable during registration, frozen before return
  const resolverServicesMutable: {
    marketResolver: MarketResolverFn | undefined;
    perpProviders: PerpProviderRegistry;
  } = {
    marketResolver: undefined,
    perpProviders,
  };

  // Register chain modules for each configured chain
  for (const [chainName, chainConfig] of Object.entries(config.chain)) {
    if (!chainModules.has(chainName)) {
      logger.warn(
        { chain: chainName },
        'No chain module registered for configured chain — skipping',
      );
      continue;
    }

    const ctx: ChainRegistrationContext = {
      config: chainConfig,
      db,
      activityLog,
      coinMetadataRepo,
      lpPro,
      chainAdapterFactory,
      dataProviders,
      actionBuilderRegistry,
      signerRegistry,
      keyDeriverRegistry,
      mevProtectors,
      perpProviders,
      policyRegistry,
      setMarketResolver(resolver: MarketResolverFn): void {
        resolverServicesMutable.marketResolver = resolver;
      },
    };

    chainModules.get(chainName).register(ctx);
    logger.info({ chain: chainName }, 'Chain module registered');
  }

  const intentResolverRegistry = buildIntentResolverRegistry();

  let closed = false;

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    // Chain modules own their SDK clients (e.g., BluefinClient).
    // perpProviders are NOT disposed separately to avoid double-dispose.
    try {
      await chainModules.disposeAll();
    } catch (err: unknown) {
      logger.warn({ err }, 'Error disposing chain modules');
    }
    try {
      db.close();
    } catch (err: unknown) {
      logger.warn({ err }, 'Error closing database');
    }
  }

  logger.info('Bootstrap complete');

  return {
    db,
    config,
    dataProviders,
    activityLog,
    coinMetadataRepo,
    perpProviders,
    cliEventLog,
    policyRegistry,
    chainAdapterFactory,
    actionBuilderRegistry,
    intentResolverRegistry,
    mevProtectors,
    signerRegistry,
    resolverServices: resolverServicesMutable,
    chainModules,
    logger,
    close,
  };
}

/**
 * Build a ChainModuleRegistry with all available chain modules.
 *
 * Each supported chain registers its module here. This is the single place
 * where new chains are added to the system.
 *
 * @returns ChainModuleRegistry with all available chain modules
 */
export function buildChainModuleRegistry(): ChainModuleRegistry {
  const registry = new ChainModuleRegistry();
  registry.register(new SuiChainModule());
  registry.register(new SolanaChainModule());
  return registry;
}

/**
 * Build a KeyDeriverRegistry with derivers from all available chain modules.
 *
 * Derives the registry from the ChainModuleRegistry so new chains only
 * need to implement `createKeyDeriver()` — no separate registration needed.
 *
 * @returns KeyDeriverRegistry with all chain derivers registered
 */
export function buildKeyDeriverRegistry(): KeyDeriverRegistry {
  const modules = buildChainModuleRegistry();
  const registry = new KeyDeriverRegistry();
  for (const chain of modules.list()) {
    registry.register(modules.get(chain).createKeyDeriver());
  }
  return registry;
}
