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
import type { HyperliquidClient } from './client.js';

const PERP_COIN_TYPE_PREFIX = 'hyperliquid:';

/**
 * Hardcoded subset of Hyperliquid markets covered by the policy
 * allowlist. Querying `info.meta()` on every CLI invocation would
 * fetch ~140 markets and inflate latency for no benefit today.
 * Extend this list to add more markets.
 */
const HYPERLIQUID_MARKETS: readonly PerpMarketInfo[] = [
  makeMarket('ETH-USD', 'ETH'),
  makeMarket('BTC-USD', 'BTC'),
  makeMarket('SOL-USD', 'SOL'),
];

function makeMarket(symbol: string, baseAsset: string): PerpMarketInfo {
  return {
    symbol,
    baseAsset,
    status: 'active',
    minOrderSizeE9: '10000000',
    maxOrderSizeE9: '0',
    tickSizeE9: '10000000',
    stepSizeE9: '10000000',
    defaultLeverageE9: '1000000000',
    maxLeverageE9: '50000000000',
    minOrderPriceE9: '0',
    maxOrderPriceE9: '0',
    makerFeeE9: '0',
    takerFeeE9: '0',
  };
}

/**
 * Hyperliquid PerpProvider — covers market enumeration, symbol
 * resolution, and ticker price. Account / position / fills queries
 * are intentionally stubbed until the CLI needs them.
 */
export class HyperliquidPerpProvider implements PerpProvider {
  readonly protocol: PerpProtocol = 'hyperliquid';

  constructor(private readonly getClient: () => HyperliquidClient) {}

  async getTickerPrice(marketSymbol: string): Promise<number> {
    const coin = marketSymbol.split('-')[0] ?? marketSymbol;
    const client = this.getClient();
    const allMidsRaw: unknown = await client.sdk.info.getAllMids();
    if (typeof allMidsRaw !== 'object' || allMidsRaw === null) {
      throw new Error('Hyperliquid getAllMids returned an unexpected response');
    }
    const mids = allMidsRaw as Record<string, string>;
    const raw = mids[coin];
    if (raw === undefined) {
      throw new Error(`Hyperliquid has no ticker for "${coin}"`);
    }
    const price = Number.parseFloat(raw);
    if (!Number.isFinite(price)) {
      throw new Error(`Hyperliquid returned a non-numeric price for "${coin}": ${raw}`);
    }
    return price;
  }

  getMarkets(): Promise<PerpMarketInfo[]> {
    return Promise.resolve([...HYPERLIQUID_MARKETS]);
  }

  resolveMarket(rawSymbol: string): Promise<string> {
    const upper = rawSymbol.toUpperCase();
    const normalized = upper.includes('-') ? upper : `${upper}-USD`;
    const market = HYPERLIQUID_MARKETS.find((m) => m.symbol === normalized);
    if (market === undefined) {
      const available = HYPERLIQUID_MARKETS.map((m) => m.symbol).join(', ');
      return Promise.reject(
        new Error(`Unknown Hyperliquid market "${rawSymbol}". Available: ${available}`),
      );
    }
    return Promise.resolve(market.symbol);
  }

  getAccount(): Promise<PerpAccount> {
    return Promise.reject(
      new Error('Hyperliquid account query not implemented yet — requires wallet context'),
    );
  }

  getPositions(): Promise<readonly PerpPosition[]> {
    return Promise.resolve([]);
  }

  getOpenOrders(_symbol?: string): Promise<readonly PerpOpenOrder[]> {
    return Promise.resolve([]);
  }

  getStandbyOrders(_symbol?: string): Promise<readonly PerpOpenOrder[]> {
    return Promise.resolve([]);
  }

  getTrades(_params?: PerpQueryParams & { symbol?: string }): Promise<readonly PerpTrade[]> {
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
    for (const market of HYPERLIQUID_MARKETS) {
      repo.upsert({
        coin_type: this.toMarketCoinType(market.baseAsset),
        chain_id: chainId,
        symbol: market.baseAsset,
        name: `${market.baseAsset} (Hyperliquid)`,
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
    return Promise.resolve({ synced: 0 });
  }

  enrichError(message: string): string {
    if (message.toLowerCase().includes('insufficient margin')) {
      return `${message} (deposit more USDC into Hyperliquid before increasing exposure)`;
    }
    return message;
  }

  async dispose(): Promise<void> {
    // Client disposal is owned by the chain module.
    await Promise.resolve();
  }
}
