import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import type Database from 'better-sqlite3';
import type { ActionBuilderRegistry } from '../../core/action-builder.js';
import type { DataProviderRegistry } from '../../core/data-provider.js';
import { DataProviderWithCache } from '../../core/data-provider.js';
import type { MevProtector } from '../../core/mev-protector.js';
import { NoOpMevProtector } from '../../core/mev-protector.js';
import { PriceCache } from '../../core/price-cache.js';
import type { LPProService } from '../../data/lp-pro-service.js';
import type { ActivityLog } from '../../db/activity-log.js';
import { CoinMetadataRepository } from '../../db/coin-metadata-repo.js';
import type { ChainAdapterFactory } from '../factory.js';
import { SuiSwapBuilder } from './7k/swap.js';
import { SuiAdapter } from './adapter.js';
import { createAlphaLendClient } from './alphalend/client.js';
import { AlphaLendBorrowBuilder } from './alphalend/borrow.js';
import { AlphaLendClaimRewardsBuilder } from './alphalend/claim-rewards.js';
import { AlphaLendRepayBuilder } from './alphalend/repay.js';
import { AlphaLendSupplyBuilder } from './alphalend/supply.js';
import { AlphaLendWithdrawBuilder } from './alphalend/withdraw.js';
import { SuiDataProvider } from './data-provider.js';
import { SUI_KNOWN_DECIMALS } from './tokens.js';
import type { ChainConfig } from '../../types/config.js';

/**
 * Result of bootstrapping the Sui chain.
 */
export interface SuiBootstrapResult {
  readonly alphalendClient: AlphalendClient;
  readonly suiClient: SuiJsonRpcClient;
}

/**
 * All registries that Sui bootstrap needs to populate.
 */
interface SuiBootstrapRegistries {
  readonly chainAdapterFactory: ChainAdapterFactory;
  readonly dataProviders: DataProviderRegistry;
  readonly actionBuilderRegistry: ActionBuilderRegistry;
  readonly mevProtectors: Map<string, MevProtector>;
}

/**
 * Bootstrap the Sui chain: register adapter, data provider, action builders.
 *
 * @param config - Sui chain configuration
 * @param db - SQLite database connection
 * @param lpPro - Shared LPProService instance
 * @param activityLog - Activity log instance
 * @param registries - Registries to populate with Sui-specific components
 * @returns Sui-specific service instances (AlphaLend client, SuiJsonRpcClient)
 */
export function bootstrapSuiChain(
  config: ChainConfig,
  db: Database.Database,
  lpPro: LPProService,
  activityLog: ActivityLog,
  registries: SuiBootstrapRegistries,
): SuiBootstrapResult {
  const rpcUrl = process.env['SUI_RPC_URL'] ?? config.rpc;
  const suiClient = new SuiJsonRpcClient({ url: rpcUrl, network: 'mainnet' });
  const alphalendClient = createAlphaLendClient(suiClient, 'mainnet');

  // Register chain adapter
  registries.chainAdapterFactory.register(new SuiAdapter(suiClient));

  // Register data provider (lazy)
  registries.dataProviders.register('sui', () => {
    const inner = new SuiDataProvider(lpPro, SUI_KNOWN_DECIMALS);
    const repo = new CoinMetadataRepository(db);
    const cached = new DataProviderWithCache(inner, repo);
    return new PriceCache(cached);
  });

  // Register action builders
  registries.actionBuilderRegistry.registerFactory('sui', 'trade:swap', '7k', (intent) => {
    const slippageBps = intent.action === 'trade:swap' ? intent.params.slippageBps : 100;
    return new SuiSwapBuilder(activityLog, slippageBps);
  });

  registries.actionBuilderRegistry.registerFactory(
    'sui',
    'lending:supply',
    'alphalend',
    (_intent) => new AlphaLendSupplyBuilder(alphalendClient, suiClient, activityLog),
  );
  registries.actionBuilderRegistry.registerFactory(
    'sui',
    'lending:borrow',
    'alphalend',
    (_intent) => new AlphaLendBorrowBuilder(alphalendClient, suiClient, activityLog),
  );
  registries.actionBuilderRegistry.registerFactory(
    'sui',
    'lending:withdraw',
    'alphalend',
    (_intent) => new AlphaLendWithdrawBuilder(alphalendClient, suiClient, activityLog),
  );
  registries.actionBuilderRegistry.registerFactory(
    'sui',
    'lending:repay',
    'alphalend',
    (_intent) => new AlphaLendRepayBuilder(alphalendClient, suiClient, activityLog),
  );
  registries.actionBuilderRegistry.registerFactory(
    'sui',
    'lending:claim_rewards',
    'alphalend',
    (_intent) => new AlphaLendClaimRewardsBuilder(alphalendClient, suiClient, activityLog),
  );

  // Register MEV protector
  registries.mevProtectors.set('sui', new NoOpMevProtector());

  return { alphalendClient, suiClient };
}
