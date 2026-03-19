import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { ChainAdapterFactory } from '../chain/factory.js';
import { SuiSwapBuilder } from '../chain/sui/7k/swap.js';
import { SuiAdapter } from '../chain/sui/adapter.js';
import { createAlphaLendClient } from '../chain/sui/alphalend/client.js';
import { AlphaLendBorrowBuilder } from '../chain/sui/alphalend/borrow.js';
import { AlphaLendClaimRewardsBuilder } from '../chain/sui/alphalend/claim-rewards.js';
import { AlphaLendRepayBuilder } from '../chain/sui/alphalend/repay.js';
import { AlphaLendSupplyBuilder } from '../chain/sui/alphalend/supply.js';
import { AlphaLendWithdrawBuilder } from '../chain/sui/alphalend/withdraw.js';
import { SUI_KNOWN_DECIMALS, tryResolveTokenAddress } from '../chain/sui/tokens.js';
import { CONFIG_PATH, loadConfig } from '../config/loader.js';
import { ActionBuilderRegistry } from '../core/action-builder.js';
import { type MevProtector, NoOpMevProtector } from '../core/mev-protector.js';
import { CachedCoinMetadataService } from '../data/cached-coin-metadata.js';
import type { CoinMetadataService } from '../data/coin-metadata.js';
import { NoodlesCoinMetadataService } from '../data/coin-metadata.js';
import { CliEventLog } from '../db/cli-events.js';
import { CoinMetadataRepository } from '../db/coin-metadata-repo.js';
import { DB_PATH, openDatabase } from '../db/connection.js';
import { LendingLog } from '../db/lending-log.js';
import { TradeLog } from '../db/trade-log.js';
import { getLogger } from '../logger/index.js';
import type { OracleClient } from '../oracle/client.js';
import { CoinGeckoOracle } from '../oracle/coingecko.js';
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
  readonly oracle: OracleClient;
  readonly tradeLog: TradeLog;
  readonly lendingLog: LendingLog;
  readonly alphalendClient: AlphalendClient;
  readonly cliEventLog: CliEventLog;
  readonly policyRegistry: PolicyCheckRegistry;
  readonly chainAdapterFactory: ChainAdapterFactory;
  readonly actionBuilderRegistry: ActionBuilderRegistry;
  readonly mevProtectors: Map<string, MevProtector>;
  readonly coinMetadataService: CoinMetadataService;
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
 * 4. Create oracle client
 * 5. Create trade log and CLI event log
 * 6. Create policy registry and register checks based on config sections
 * 7. Create chain adapter factory and register adapters
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

  const oracle = new CoinGeckoOracle();
  const tradeLog = new TradeLog(db);
  const lendingLog = new LendingLog(db);
  const cliEventLog = new CliEventLog(db);
  const policyRegistry = buildPolicyRegistry(config);
  const suiClient = new SuiJsonRpcClient({
    url: process.env['SUI_RPC_URL'] ?? SUI_MAINNET_RPC,
    network: 'mainnet',
  });
  const alphalendClient = createAlphaLendClient(suiClient, 'mainnet');
  const chainAdapterFactory = buildChainAdapterFactory(suiClient);
  const actionBuilderRegistry = buildActionBuilderRegistry(
    tradeLog,
    alphalendClient,
    suiClient,
    lendingLog,
  );
  const mevProtectors = buildMevProtectors();
  const coinMetadataService = buildCoinMetadataService(db);

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
    oracle,
    tradeLog,
    lendingLog,
    alphalendClient,
    cliEventLog,
    policyRegistry,
    chainAdapterFactory,
    actionBuilderRegistry,
    mevProtectors,
    coinMetadataService,
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
 * @param tradeLog - Trade log instance for builders that log trades
 * @returns ActionBuilderRegistry with SuiSwapBuilder factory registered
 */
export function buildActionBuilderRegistry(
  tradeLog: TradeLog,
  alphalendClient: AlphalendClient,
  suiClient: SuiJsonRpcClient,
  lendingLog: LendingLog,
): ActionBuilderRegistry {
  const registry = new ActionBuilderRegistry();

  registry.registerFactory('sui', 'swap', '7k', (intent) => {
    const slippageBps = intent.action === 'swap' ? intent.params.slippageBps : 100;
    return new SuiSwapBuilder(tradeLog, slippageBps);
  });

  registry.registerFactory(
    'sui',
    'supply',
    'alphalend',
    (_intent) => new AlphaLendSupplyBuilder(alphalendClient, lendingLog),
  );
  registry.registerFactory(
    'sui',
    'borrow',
    'alphalend',
    (_intent) => new AlphaLendBorrowBuilder(alphalendClient, suiClient, lendingLog),
  );
  registry.registerFactory(
    'sui',
    'withdraw',
    'alphalend',
    (_intent) => new AlphaLendWithdrawBuilder(alphalendClient, suiClient, lendingLog),
  );
  registry.registerFactory(
    'sui',
    'repay',
    'alphalend',
    (_intent) => new AlphaLendRepayBuilder(alphalendClient, suiClient, lendingLog),
  );
  registry.registerFactory(
    'sui',
    'claim_rewards',
    'alphalend',
    (_intent) => new AlphaLendClaimRewardsBuilder(alphalendClient, suiClient, lendingLog),
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

/**
 * Build a CoinMetadataService with DB-backed caching.
 *
 * Wraps the Noodles API service with a local SQLite cache so coin metadata
 * (decimals, symbol) is persisted across CLI invocations. Falls back to
 * SUI_KNOWN_DECIMALS for well-known tokens when the API is unreachable.
 *
 * @param db - SQLite database connection (for the coin_metadata cache table)
 * @returns CoinMetadataService instance with DB caching
 */
export function buildCoinMetadataService(db: Database.Database): CoinMetadataService {
  const apiKey = process.env['NOODLES_API_KEY'];
  const inner = new NoodlesCoinMetadataService(SUI_KNOWN_DECIMALS, apiKey);
  const repo = new CoinMetadataRepository(db);
  return new CachedCoinMetadataService(repo, inner);
}
