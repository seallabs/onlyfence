import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type { AppConfig } from '../types/config.js';
import type { OracleClient } from '../oracle/client.js';
import { openDatabase, DB_PATH } from '../db/connection.js';
import { loadConfig, CONFIG_PATH } from '../config/loader.js';
import { CoinGeckoOracle } from '../oracle/coingecko.js';
import { TradeLog } from '../db/trade-log.js';
import { CliEventLog } from '../db/cli-events.js';
import { PolicyCheckRegistry } from '../policy/registry.js';
import { TokenAllowlistCheck } from '../policy/checks/token-allowlist.js';
import { SpendingLimitCheck } from '../policy/checks/spending-limit.js';
import { ChainAdapterFactory } from '../chain/factory.js';
import { SuiAdapter } from '../chain/sui/adapter.js';
import { getLogger } from '../logger/index.js';
import { initSentry } from '../telemetry/sentry.js';

/**
 * All initialized application components returned by bootstrap.
 */
export interface AppComponents {
  readonly db: Database.Database;
  readonly config: AppConfig;
  readonly oracle: OracleClient;
  readonly tradeLog: TradeLog;
  readonly cliEventLog: CliEventLog;
  readonly policyRegistry: PolicyCheckRegistry;
  readonly chainAdapterFactory: ChainAdapterFactory;
  readonly logger: Logger;
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
  if (config.telemetry !== undefined) {
    initSentry(config.telemetry);
  }

  const oracle = new CoinGeckoOracle();
  const tradeLog = new TradeLog(db);
  const cliEventLog = new CliEventLog(db);
  const policyRegistry = buildPolicyRegistry(config);
  const chainAdapterFactory = buildChainAdapterFactory();

  logger.info('Bootstrap complete');

  return { db, config, oracle, tradeLog, cliEventLog, policyRegistry, chainAdapterFactory, logger };
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

  registry.register(new TokenAllowlistCheck());
  registry.register(new SpendingLimitCheck());

  return registry;
}

/**
 * Build a chain adapter factory with all supported adapters registered.
 *
 * @returns ChainAdapterFactory with SuiAdapter registered
 */
export function buildChainAdapterFactory(): ChainAdapterFactory {
  const factory = new ChainAdapterFactory();
  factory.register(new SuiAdapter());
  return factory;
}
