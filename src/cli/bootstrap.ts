import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import { ChainAdapterFactory } from '../chain/factory.js';
import { SuiSwapBuilder } from '../chain/sui/7k/swap.js';
import { SuiAdapter } from '../chain/sui/adapter.js';
import { AlphaLendBorrowBuilder } from '../chain/sui/alphalend/borrow.js';
import { AlphaLendClaimRewardsBuilder } from '../chain/sui/alphalend/claim-rewards.js';
import { createAlphaLendClient } from '../chain/sui/alphalend/client.js';
import { AlphaLendRepayBuilder } from '../chain/sui/alphalend/repay.js';
import { AlphaLendSupplyBuilder } from '../chain/sui/alphalend/supply.js';
import { AlphaLendWithdrawBuilder } from '../chain/sui/alphalend/withdraw.js';
import { SuiDataProvider } from '../chain/sui/data-provider.js';
import { SUI_KNOWN_DECIMALS, tryResolveTokenAddress } from '../chain/sui/tokens.js';
import { CONFIG_PATH, ONLYFENCE_DIR, loadConfig } from '../config/loader.js';
import { ActionBuilderRegistry } from '../core/action-builder.js';
import { DataProviderRegistry, DataProviderWithCache } from '../core/data-provider.js';
import { type MevProtector, NoOpMevProtector } from '../core/mev-protector.js';
import { PriceCache } from '../core/price-cache.js';
import { ensureSecureDataDir } from '../security/file-permissions.js';
import { LPProService } from '../data/lp-pro-service.js';
import { ActivityLog } from '../db/activity-log.js';
import { CliEventLog } from '../db/cli-events.js';
import { CoinMetadataRepository } from '../db/coin-metadata-repo.js';
import { DB_PATH, openDatabase } from '../db/connection.js';
import { getLogger } from '../logger/index.js';
import { SpendingLimitCheck } from '../policy/checks/spending-limit.js';
import { TokenAllowlistCheck } from '../policy/checks/token-allowlist.js';
import { PolicyCheckRegistry } from '../policy/registry.js';
import { initSentry } from '../telemetry/sentry.js';
import type { AppConfig } from '../types/config.js';

/**
 * All initialized application components returned by bootstrap.
 */
export interface AppComponents {
  readonly db: Database.Database;
  readonly config: AppConfig;
  readonly dataProviders: DataProviderRegistry;
  readonly activityLog: ActivityLog;
  readonly alphalendClient: AlphalendClient;
  readonly cliEventLog: CliEventLog;
  readonly policyRegistry: PolicyCheckRegistry;
  readonly chainAdapterFactory: ChainAdapterFactory;
  readonly actionBuilderRegistry: ActionBuilderRegistry;
  readonly mevProtectors: Map<string, MevProtector>;
  readonly logger: Logger;

  /** Close the database and release resources. Safe to call multiple times. */
  close(): void;
}

/**
 * Bootstrap the OnlyFence application by initializing all core components.
 *
 * Steps:
 * 1. Open/create SQLite DB and run migrations
 * 2. Load config from TOML
 * 3. Initialize Sentry if telemetry is enabled
 * 4. Register data provider factories (lazy-init per chain)
 * 5. Create trade log and CLI event log
 * 6. Create policy registry and register checks based on config sections
 * 7. Create chain adapter factory and register adapters
 *
 * @param options - Optional overrides for paths
 * @returns Fully initialized AppComponents
 * @throws Error if DB or config initialization fails
 */
export function bootstrap(options?: { dbPath?: string; configPath?: string }): AppComponents {
  // Enforce 0o600 on all sensitive files before opening them.
  // This runs on every command, not just first-run, catching permission drift.
  ensureSecureDataDir(ONLYFENCE_DIR);

  const db = openDatabase(options?.dbPath ?? DB_PATH);
  const config = loadConfig(options?.configPath ?? CONFIG_PATH);
  const logger = getLogger();

  // Initialize Sentry if telemetry is configured and enabled
  initSentry(config.telemetry?.enabled ?? false);

  const lpPro = new LPProService();
  const dataProviders = buildDataProviderRegistry(db, lpPro);
  const activityLog = new ActivityLog(db);
  const cliEventLog = new CliEventLog(db);
  const policyRegistry = buildPolicyRegistry(config);
  const suiClient = new SuiJsonRpcClient({
    url: process.env['SUI_RPC_URL'] ?? SUI_MAINNET_RPC,
    network: 'mainnet',
  });
  const alphalendClient = createAlphaLendClient(suiClient, 'mainnet');
  const chainAdapterFactory = buildChainAdapterFactory(suiClient);
  const actionBuilderRegistry = buildActionBuilderRegistry(activityLog, alphalendClient, suiClient);
  const mevProtectors = buildMevProtectors();

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

  return {
    db,
    config,
    dataProviders,
    activityLog,
    alphalendClient,
    cliEventLog,
    policyRegistry,
    chainAdapterFactory,
    actionBuilderRegistry,
    mevProtectors,
    logger,
    close,
  };
}

/**
 * Build a DataProviderRegistry with lazy factories for each chain.
 *
 * The actual DataProvider (SuiDataProvider + cache) is only created
 * when first requested via `registry.get(chain)`.
 *
 * @param db - SQLite database connection (for metadata cache)
 * @param lpPro - Shared LPProService instance
 * @returns DataProviderRegistry with all chain factories registered
 */
export function buildDataProviderRegistry(
  db: Database.Database,
  lpPro: LPProService,
): DataProviderRegistry {
  const registry = new DataProviderRegistry();

  registry.register('sui', () => {
    const inner = new SuiDataProvider(lpPro, SUI_KNOWN_DECIMALS);
    const repo = new CoinMetadataRepository(db);
    const cached = new DataProviderWithCache(inner, repo);
    // Wrap with fail-closed price cache: if oracle is unreachable and
    // cached price is older than 5 minutes, trades requiring USD pricing
    // are rejected. This blocks the #1 attack vector (oracle manipulation).
    return new PriceCache(cached);
  });

  return registry;
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

/**
 * Build a chain adapter factory with all supported adapters registered.
 *
 * @param suiClient - Shared SuiJsonRpcClient instance
 * @returns ChainAdapterFactory with SuiAdapter registered
 */
/** Default Sui mainnet RPC endpoint. */
const SUI_MAINNET_RPC = 'https://fullnode.mainnet.sui.io:443';

export function buildChainAdapterFactory(suiClient: SuiJsonRpcClient): ChainAdapterFactory {
  const factory = new ChainAdapterFactory();
  factory.register(new SuiAdapter(suiClient));
  return factory;
}

/**
 * Build an ActionBuilderRegistry with all supported builders registered.
 *
 * Uses factory registration so builders are created lazily per-intent,
 * allowing intent-specific configuration (e.g., slippage).
 *
 * @param activityLog - Activity log instance for builders that log activities
 * @returns ActionBuilderRegistry with all builder factories registered
 */
export function buildActionBuilderRegistry(
  activityLog: ActivityLog,
  alphalendClient: AlphalendClient,
  suiClient: SuiJsonRpcClient,
): ActionBuilderRegistry {
  const registry = new ActionBuilderRegistry();

  registry.registerFactory('sui', 'trade:swap', '7k', (intent) => {
    const slippageBps = intent.action === 'trade:swap' ? intent.params.slippageBps : 100;
    return new SuiSwapBuilder(activityLog, slippageBps);
  });

  registry.registerFactory(
    'sui',
    'lending:supply',
    'alphalend',
    (_intent) => new AlphaLendSupplyBuilder(alphalendClient, suiClient, activityLog),
  );
  registry.registerFactory(
    'sui',
    'lending:borrow',
    'alphalend',
    (_intent) => new AlphaLendBorrowBuilder(alphalendClient, suiClient, activityLog),
  );
  registry.registerFactory(
    'sui',
    'lending:withdraw',
    'alphalend',
    (_intent) => new AlphaLendWithdrawBuilder(alphalendClient, suiClient, activityLog),
  );
  registry.registerFactory(
    'sui',
    'lending:repay',
    'alphalend',
    (_intent) => new AlphaLendRepayBuilder(alphalendClient, suiClient, activityLog),
  );
  registry.registerFactory(
    'sui',
    'lending:claim_rewards',
    'alphalend',
    (_intent) => new AlphaLendClaimRewardsBuilder(alphalendClient, suiClient, activityLog),
  );

  return registry;
}

/**
 * Build a map of MEV protectors keyed by chain identifier.
 *
 * @returns Map of chain -> MevProtector
 */
export function buildMevProtectors(): Map<string, MevProtector> {
  const protectors = new Map<string, MevProtector>();
  protectors.set('sui', new NoOpMevProtector());
  return protectors;
}
