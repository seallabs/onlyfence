import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { ChainAdapterFactory } from '../chain/factory.js';
import { SuiKeyDeriver } from '../chain/sui/key-deriver.js';
import { SuiSwapBuilder } from '../chain/sui/7k/swap.js';
import { SuiAdapter } from '../chain/sui/adapter.js';
import { buildSuiSigner } from '../chain/sui/signer.js';
import { AlphaLendBorrowBuilder } from '../chain/sui/alphalend/borrow.js';
import { AlphaLendClaimRewardsBuilder } from '../chain/sui/alphalend/claim-rewards.js';
import { resolveMarketId } from '../chain/sui/alphalend/markets.js';
import { createAlphaLendClient } from '../chain/sui/alphalend/client.js';
import { AlphaLendRepayBuilder } from '../chain/sui/alphalend/repay.js';
import { AlphaLendSupplyBuilder } from '../chain/sui/alphalend/supply.js';
import { AlphaLendWithdrawBuilder } from '../chain/sui/alphalend/withdraw.js';
import { BluefinCancelOrderBuilder } from '../chain/sui/bluefin-pro/cancel-order.js';
import { BluefinClient } from '../chain/sui/bluefin-pro/client.js';
import { BluefinDepositBuilder } from '../chain/sui/bluefin-pro/deposit.js';
import { BluefinPlaceOrderBuilder } from '../chain/sui/bluefin-pro/place-order.js';
import { BluefinPerpProvider } from '../chain/sui/bluefin-pro/provider.js';
import { BluefinWithdrawBuilder } from '../chain/sui/bluefin-pro/withdraw.js';
import { SuiDataProvider } from '../chain/sui/data-provider.js';
import { SUI_KNOWN_DECIMALS, tryResolveTokenAddress } from '../chain/sui/tokens.js';
import { CONFIG_PATH, loadConfig } from '../config/loader.js';
import { ActionBuilderRegistry } from '../core/action-builder.js';
import type { IntentResolverRegistry, ResolverServices } from '../core/intent-resolver.js';
import { buildIntentResolverRegistry } from '../core/resolvers/index.js';
import { DataProviderRegistry, DataProviderWithCache } from '../core/data-provider.js';
import { type MevProtector, NoOpMevProtector } from '../core/mev-protector.js';
import { PriceCache } from '../core/price-cache.js';
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
import { TokenAllowlistCheck } from '../policy/checks/token-allowlist.js';
import { PolicyCheckRegistry } from '../policy/registry.js';
import { initSentry } from '../telemetry/sentry.js';
import type { AppConfig } from '../types/config.js';
import { KeyDeriverRegistry } from '../wallet/key-deriver.js';
import { SignerRegistry } from '../wallet/signer-registry.js';
import { loadSessionKeyBytes as loadSessionKeyBytesSync } from '../wallet/session.js';

/**
 * All initialized application components returned by bootstrap.
 */
export interface AppComponents {
  readonly db: Database.Database;
  readonly config: AppConfig;
  readonly dataProviders: DataProviderRegistry;
  readonly activityLog: ActivityLog;
  readonly alphalendClient: AlphalendClient;
  readonly coinMetadataRepo: CoinMetadataRepository;
  /** Lazily creates and returns a BluefinClient. Throws if wallet is not unlocked. */
  getBluefinClient(): BluefinClient;
  /** Protocol-abstract perp provider registry. Prefer this over getBluefinClient(). */
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
  const db = openDatabase(options?.dbPath ?? DB_PATH);
  const config = loadConfig(options?.configPath ?? CONFIG_PATH);
  const logger = getLogger();

  // Initialize Sentry if telemetry is configured and enabled
  initSentry(config.telemetry?.enabled ?? false);

  const lpPro = new LPProService();
  const coinMetadataRepo = new CoinMetadataRepository(db);
  const dataProviders = buildDataProviderRegistry(db, lpPro, coinMetadataRepo);
  const activityLog = new ActivityLog(db);
  const cliEventLog = new CliEventLog(db);
  const policyRegistry = buildPolicyRegistry(config);
  const suiChainConfig = config.chain.sui;
  const suiRpc = suiChainConfig?.rpc ?? process.env['SUI_RPC_URL'] ?? SUI_MAINNET_RPC;
  const suiNetwork = (suiChainConfig?.network ?? 'mainnet') as 'mainnet' | 'testnet';
  const suiClient = new SuiJsonRpcClient({
    url: suiRpc,
    network: suiNetwork,
  });
  const alphalendClient = createAlphaLendClient(suiClient, suiNetwork);
  const chainAdapterFactory = buildChainAdapterFactory(suiClient);
  const signerRegistry = buildSignerRegistry();

  // Bluefin client is created lazily on first access via getBluefinClient().
  // Requires an active wallet session (unlocked) to derive the keypair.
  let cachedBluefinClient: BluefinClient | undefined;

  function getBluefinClient(): BluefinClient {
    if (cachedBluefinClient !== undefined) return cachedBluefinClient;

    const keyBytes = loadSessionKeyBytesSync('sui:mainnet');
    const seed = keyBytes.length === 64 ? keyBytes.subarray(0, 32) : keyBytes;
    const keypair = Ed25519Keypair.fromSecretKey(seed);

    cachedBluefinClient = new BluefinClient({
      network: 'mainnet',
      suiClient,
      keypair,
    });
    return cachedBluefinClient;
  }

  const actionBuilderRegistry = buildActionBuilderRegistry(
    activityLog,
    alphalendClient,
    suiClient,
    getBluefinClient,
  );
  const intentResolverRegistry = buildIntentResolverRegistry();
  const mevProtectors = buildMevProtectors();

  // Build perp provider registry (lazy — providers are created on first access via getBluefinClient)
  const perpProviders = new PerpProviderRegistry();
  // Register Bluefin lazily: the provider wraps getBluefinClient() which is itself lazy.
  // We defer registration until first use so we don't force wallet unlock at bootstrap.
  perpProviders.registerLazy('bluefin_pro', () => new BluefinPerpProvider(getBluefinClient()));

  let closed = false;

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    // Dispose perp providers (which includes Bluefin client) to clear SDK timers.
    if (perpProviders.isInitialized('bluefin_pro')) {
      try {
        await perpProviders.disposeAll();
      } catch (err: unknown) {
        logger.warn({ err }, 'Error disposing perp providers');
      }
    } else if (cachedBluefinClient !== undefined) {
      // If provider was never registered but client was created directly
      try {
        await cachedBluefinClient.dispose();
      } catch (err: unknown) {
        logger.warn({ err }, 'Error disposing Bluefin client');
      }
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
    alphalendClient,
    coinMetadataRepo,
    getBluefinClient,
    perpProviders,
    cliEventLog,
    policyRegistry,
    chainAdapterFactory,
    actionBuilderRegistry,
    intentResolverRegistry,
    mevProtectors,
    signerRegistry,
    resolverServices: {
      marketResolver: (coinType: string, explicitMarketId?: string) =>
        resolveMarketId(alphalendClient, coinType, explicitMarketId),
      perpProviders,
    },
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
  coinMetadataRepo?: CoinMetadataRepository,
): DataProviderRegistry {
  const registry = new DataProviderRegistry();

  registry.register('sui', () => {
    const inner = new SuiDataProvider(lpPro, SUI_KNOWN_DECIMALS);
    const repo = coinMetadataRepo ?? new CoinMetadataRepository(db);
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
  registry.register(new PerpMarketAllowlistCheck());
  registry.register(new PerpLeverageCapCheck());
  registry.register(new PerpOrderSizeCheck());
  registry.register(new PerpVolumeCheck());
  registry.register(new PerpWithdrawLimitCheck());

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
  getBluefinClient?: () => BluefinClient,
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

  // Bluefin Pro perp builders (off-chain signed).
  // getBluefinClient() is called at factory invocation time (lazy), not at registration time.
  if (getBluefinClient !== undefined) {
    registry.registerFactory(
      'sui',
      'perp:place_order',
      'bluefin_pro',
      (_intent) => new BluefinPlaceOrderBuilder(getBluefinClient(), activityLog),
    );
    registry.registerFactory(
      'sui',
      'perp:cancel_order',
      'bluefin_pro',
      (_intent) => new BluefinCancelOrderBuilder(getBluefinClient(), activityLog),
    );
    registry.registerFactory(
      'sui',
      'perp:deposit',
      'bluefin_pro',
      (_intent) => new BluefinDepositBuilder(getBluefinClient(), activityLog),
    );
    registry.registerFactory(
      'sui',
      'perp:withdraw',
      'bluefin_pro',
      (_intent) => new BluefinWithdrawBuilder(getBluefinClient(), activityLog),
    );
  }

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
 * Build a SignerRegistry with all supported chain signer factories.
 *
 * Each chain registers a factory that knows how to produce a Signer from raw key bytes.
 *
 * @returns SignerRegistry with all chain factories registered
 */
export function buildSignerRegistry(): SignerRegistry {
  const registry = new SignerRegistry();
  registry.register('sui', buildSuiSigner);
  return registry;
}

/**
 * Build a KeyDeriverRegistry with all supported chain key derivers.
 *
 * Each chain registers a KeyDeriver that handles seed derivation and
 * chain-specific private key parsing.
 *
 * @returns KeyDeriverRegistry with all chain derivers registered
 */
export function buildKeyDeriverRegistry(): KeyDeriverRegistry {
  const registry = new KeyDeriverRegistry();
  registry.register(new SuiKeyDeriver());
  return registry;
}
