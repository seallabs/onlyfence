import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type { AppConfig } from '../types/config.js';
import type { OracleClient } from '../oracle/client.js';
import { type MevProtector, NoOpMevProtector } from '../core/mev-protector.js';
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
import { ActionBuilderRegistry } from '../core/action-builder.js';
import { SuiSwapBuilder } from '../chain/sui/builder/swap-builder.js';
import { getLogger } from '../logger/index.js';
import { initSentry } from '../telemetry/sentry.js';
import type { CoinMetadataService } from '../data/coin-metadata.js';
import { NoodlesCoinMetadataService } from '../data/coin-metadata.js';
import { SUI_KNOWN_DECIMALS } from '../chain/sui/tokens.js';

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
  readonly actionBuilderRegistry: ActionBuilderRegistry;
  readonly mevProtectors: Map<string, MevProtector>;
  readonly coinMetadataService: CoinMetadataService;
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
  const actionBuilderRegistry = buildActionBuilderRegistry();
  const mevProtectors = buildMevProtectors();
  const coinMetadataService = buildCoinMetadataService(logger);

  logger.info('Bootstrap complete');

  return {
    db,
    config,
    oracle,
    tradeLog,
    cliEventLog,
    policyRegistry,
    chainAdapterFactory,
    actionBuilderRegistry,
    mevProtectors,
    coinMetadataService,
    logger,
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

  registry.register(new TokenAllowlistCheck());
  registry.register(new SpendingLimitCheck());

  return registry;
}

/**
 * Build a chain adapter factory with all supported adapters registered.
 *
 * @returns ChainAdapterFactory with SuiAdapter registered
 */
/** Default Sui mainnet RPC endpoint. */
const SUI_MAINNET_RPC = 'https://fullnode.mainnet.sui.io:443';

export function buildChainAdapterFactory(): ChainAdapterFactory {
  const factory = new ChainAdapterFactory();
  factory.register(new SuiAdapter(process.env['SUI_RPC_URL'] ?? SUI_MAINNET_RPC));
  return factory;
}

/**
 * Build an ActionBuilderRegistry with all supported builders registered.
 *
 * Uses factory registration so builders are created lazily per-intent,
 * allowing intent-specific configuration (e.g., slippage).
 *
 * @returns ActionBuilderRegistry with SuiSwapBuilder factory registered
 */
export function buildActionBuilderRegistry(): ActionBuilderRegistry {
  const registry = new ActionBuilderRegistry();

  registry.registerFactory('sui', 'swap', '7k', (intent) => {
    const slippageBps = intent.action === 'swap' ? intent.params.slippageBps : 100;
    return new SuiSwapBuilder(slippageBps);
  });

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
 * Build a CoinMetadataService using the NOODLES_API_KEY env var.
 *
 * Falls back to SUI_KNOWN_DECIMALS for well-known tokens when the
 * API is unreachable. The API key is optional — free-tier calls are
 * rate-limited but still functional.
 *
 * @param _logger - Logger for diagnostic messages (reserved for future use)
 * @returns CoinMetadataService instance
 */
export function buildCoinMetadataService(_logger: Logger): CoinMetadataService {
  const apiKey = process.env['NOODLES_API_KEY'];
  return new NoodlesCoinMetadataService(SUI_KNOWN_DECIMALS, apiKey);
}
