import type { Logger } from 'pino';
import type { ChainId, PerpProtocol } from '../../../core/action-types.js';
import type {
  PerpAccount,
  PerpAccountPreferences,
  PerpFundingPayment,
  PerpFundingRateEntry,
  PerpMarketInfo,
  PerpOpenOrder,
  PerpPosition,
  PerpProvider,
  PerpQueryParams,
  PerpTrade,
} from '../../../core/perp-provider.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { CoinMetadataRepository } from '../../../db/coin-metadata-repo.js';
import type { JupiterClient } from './client.js';
import { CUSTODY_DETAILS } from '../perps/constants.js';

/** Synthetic coin type prefix for Jupiter Perps market assets. */
const PERP_COIN_TYPE_PREFIX = 'jupiter-perps:';

/** Supported Jupiter Perps markets. */
const JUPITER_PERP_MARKETS: readonly PerpMarketInfo[] = [
  {
    symbol: 'SOL-USD',
    baseAsset: 'SOL',
    status: 'active',
    minOrderSizeE9: '100000000', // 0.1 SOL
    maxOrderSizeE9: '1000000000000', // 1000 SOL
    tickSizeE9: '10000000', // 0.01
    stepSizeE9: '100000000', // 0.1
    defaultLeverageE9: '1000000000', // 1x
    maxLeverageE9: '100000000000', // 100x
    minOrderPriceE9: '0',
    maxOrderPriceE9: '0',
    makerFeeE9: '0',
    takerFeeE9: '0',
  },
  {
    symbol: 'ETH-USD',
    baseAsset: 'ETH',
    status: 'active',
    minOrderSizeE9: '10000000', // 0.01 ETH
    maxOrderSizeE9: '100000000000', // 100 ETH
    tickSizeE9: '10000000',
    stepSizeE9: '10000000',
    defaultLeverageE9: '1000000000',
    maxLeverageE9: '100000000000',
    minOrderPriceE9: '0',
    maxOrderPriceE9: '0',
    makerFeeE9: '0',
    takerFeeE9: '0',
  },
  {
    symbol: 'BTC-USD',
    baseAsset: 'BTC',
    status: 'active',
    minOrderSizeE9: '1000000', // 0.001 BTC
    maxOrderSizeE9: '10000000000', // 10 BTC
    tickSizeE9: '10000000',
    stepSizeE9: '1000000',
    defaultLeverageE9: '1000000000',
    maxLeverageE9: '100000000000',
    minOrderPriceE9: '0',
    maxOrderPriceE9: '0',
    makerFeeE9: '0',
    takerFeeE9: '0',
  },
];

/**
 * Jupiter Perpetuals provider for Solana.
 *
 * Implements the PerpProvider interface for market queries, position queries,
 * and account info. Transaction building is handled by the perp builders.
 *
 * Note: Full implementation requires Anchor IDL for on-chain account parsing.
 * Market info is static for now based on known Jupiter Perps markets.
 */
export class JupiterPerpProvider implements PerpProvider {
  readonly protocol: PerpProtocol = 'jupiter_perps';

  constructor(private readonly jupiterClient: JupiterClient) {}

  async getTickerPrice(marketSymbol: string): Promise<number> {
    const baseAsset = marketSymbol.split('-')[0];
    if (baseAsset === undefined) {
      throw new Error(`Invalid market symbol: ${marketSymbol}`);
    }

    const custody = Object.values(CUSTODY_DETAILS).find((c) => c.name === baseAsset);
    if (custody === undefined) {
      throw new Error(`Unknown base asset: ${baseAsset}`);
    }
    const mint = custody.mint.toBase58();

    const prices = await this.jupiterClient.getPrices([mint]);
    const price = prices[mint];
    if (price === undefined) {
      throw new Error(`No price available for ${baseAsset}`);
    }
    return price;
  }

  getMarkets(): Promise<PerpMarketInfo[]> {
    return Promise.resolve([...JUPITER_PERP_MARKETS]);
  }

  resolveMarket(rawSymbol: string): Promise<string> {
    const upper = rawSymbol.toUpperCase();
    // Support both "SOL" and "SOL-USD" formats
    const normalized = upper.includes('-') ? upper : `${upper}-USD`;
    const market = JUPITER_PERP_MARKETS.find((m) => m.symbol === normalized);
    if (market === undefined) {
      const available = JUPITER_PERP_MARKETS.map((m) => m.symbol).join(', ');
      return Promise.reject(new Error(`Unknown market "${rawSymbol}". Available: ${available}`));
    }
    return Promise.resolve(market.symbol);
  }

  getAccount(): Promise<PerpAccount> {
    // TODO: Implement via on-chain account parsing (Anchor IDL)
    return Promise.reject(new Error('Jupiter Perps account query requires Anchor IDL setup'));
  }

  getPositions(): Promise<readonly PerpPosition[]> {
    // TODO: Implement via on-chain position account parsing
    return Promise.reject(new Error('Jupiter Perps position query requires Anchor IDL setup'));
  }

  getOpenOrders(_symbol?: string): Promise<readonly PerpOpenOrder[]> {
    // Jupiter Perps uses market orders via keeper model, no limit order book
    return Promise.resolve([]);
  }

  getStandbyOrders(_symbol?: string): Promise<readonly PerpOpenOrder[]> {
    return Promise.resolve([]);
  }

  getTrades(_params?: PerpQueryParams & { symbol?: string }): Promise<readonly PerpTrade[]> {
    // TODO: Implement via on-chain transaction history
    return Promise.resolve([]);
  }

  getFundingRateHistory(
    _symbol: string,
    _params?: PerpQueryParams,
  ): Promise<readonly PerpFundingRateEntry[]> {
    return Promise.resolve([]);
  }

  getAccountFundingHistory(_params?: PerpQueryParams): Promise<readonly PerpFundingPayment[]> {
    return Promise.resolve([]);
  }

  getAccountPreferences(): Promise<PerpAccountPreferences> {
    return Promise.resolve({ market: [] });
  }

  toMarketCoinType(baseAsset: string): string {
    return `${PERP_COIN_TYPE_PREFIX}${baseAsset}`;
  }

  seedCoinMetadata(repo: CoinMetadataRepository, chainId: ChainId): Promise<void> {
    for (const market of JUPITER_PERP_MARKETS) {
      const coinType = this.toMarketCoinType(market.baseAsset);
      repo.upsert({
        coin_type: coinType,
        chain_id: chainId,
        symbol: market.baseAsset,
        name: `${market.baseAsset} (Jupiter Perps)`,
        decimals: 9,
      });
    }
    return Promise.resolve();
  }

  syncFills(
    _activityLog: ActivityLog,
    _coinMetadataRepo: CoinMetadataRepository,
    _chainId: ChainId,
    _walletAddress: string,
    _logger: Logger,
  ): Promise<{ synced: number }> {
    // TODO: Implement fill sync from on-chain transaction history
    return Promise.resolve({ synced: 0 });
  }

  enrichError(message: string): string {
    if (message.includes('6003') || message.includes('6046')) {
      return `${message} (Oracle accounts may be stale — retry in a few seconds)`;
    }
    return message;
  }

  dispose(): Promise<void> {
    // No resources to clean up
    return Promise.resolve();
  }
}
