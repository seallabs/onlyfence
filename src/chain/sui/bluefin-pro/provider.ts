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
import type { BluefinClient, OpenOrderResponse, Position } from './client.js';
import { fetchBluefinMarkets, resolveMarketSymbol, seedSyntheticCoinMetadata } from './markets.js';
import { syncFills } from './sync.js';
import { fromE9, toBluefinCoinType } from './types.js';

/**
 * Bluefin Pro implementation of the PerpProvider interface.
 * Maps SDK-specific types to protocol-neutral DTOs using the SDK's own typed fields.
 */
export class BluefinPerpProvider implements PerpProvider {
  readonly protocol: PerpProtocol = 'bluefin_pro';
  private marketsCache: { data: PerpMarketInfo[]; expiresAt: number } | undefined;
  private static readonly MARKETS_CACHE_TTL_MS = 30_000;

  constructor(private readonly client: BluefinClient) {}

  async getTickerPrice(marketSymbol: string): Promise<number> {
    const ticker = await this.client.getMarketTicker(marketSymbol);
    return fromE9(ticker.lastPriceE9);
  }

  async getMarkets(): Promise<PerpMarketInfo[]> {
    if (this.marketsCache !== undefined && Date.now() < this.marketsCache.expiresAt) {
      return this.marketsCache.data;
    }
    const markets = await fetchBluefinMarkets(this.client);
    this.marketsCache = {
      data: markets,
      expiresAt: Date.now() + BluefinPerpProvider.MARKETS_CACHE_TTL_MS,
    };
    return markets;
  }

  async resolveMarket(rawSymbol: string): Promise<string> {
    const markets = await this.getMarkets();
    return resolveMarketSymbol(markets, rawSymbol);
  }

  async getAccount(): Promise<PerpAccount> {
    const a = await this.client.getAccountDetails();
    return {
      accountAddress: a.accountAddress,
      marginBalanceE9: a.crossEffectiveBalanceE9,
      freeMarginE9: a.marginAvailableE9,
      accountValueE9: a.totalAccountValueE9,
      unrealizedPnlE9: a.totalUnrealizedPnlE9,
      positions: a.positions.map(mapPosition),
    };
  }

  async getPositions(): Promise<readonly PerpPosition[]> {
    const account = await this.getAccount();
    return account.positions;
  }

  async getOpenOrders(symbol?: string): Promise<readonly PerpOpenOrder[]> {
    const orders = await this.client.getOpenOrders(symbol);
    return orders.map(mapOpenOrder);
  }

  async getStandbyOrders(symbol?: string): Promise<readonly PerpOpenOrder[]> {
    const orders = await this.client.getStandbyOrders(symbol);
    return orders.map(mapOpenOrder);
  }

  async getTrades(params?: PerpQueryParams & { symbol?: string }): Promise<readonly PerpTrade[]> {
    const trades = await this.client.getTrades(params);
    return trades.map((t) => ({
      id: t.id,
      symbol: t.symbol ?? '',
      orderHash: t.orderHash ?? '',
      side: t.side,
      priceE9: t.priceE9,
      quantityE9: t.quantityE9,
      feeE9: t.tradingFeeE9 ?? '0',
      realizedPnlE9: t.realizedPnlE9,
      isMaker: t.isMaker ?? false,
    }));
  }

  async getFundingRateHistory(
    symbol: string,
    params?: PerpQueryParams,
  ): Promise<readonly PerpFundingRateEntry[]> {
    const entries = await this.client.getFundingRateHistory({ symbol, ...params });
    return entries.map((e) => ({
      symbol: e.symbol,
      fundingRateE9: e.fundingRateE9,
      fundingTimeAtMillis: e.fundingTimeAtMillis,
      fundingIntervalHours: 1, // Bluefin Pro settles funding every 1 hour
    }));
  }

  async getAccountFundingHistory(params?: PerpQueryParams): Promise<readonly PerpFundingPayment[]> {
    const history = await this.client.getAccountFundingRateHistory(params);
    const entries = history.data;
    return entries.map((e) => ({
      symbol: e.symbol,
      paymentAmountE9: e.paymentAmountE9,
      rateE9: e.rateE9,
      positionSide: e.positionSide,
      executedAtMillis: e.executedAtMillis,
    }));
  }

  async getAccountPreferences(): Promise<PerpAccountPreferences> {
    const prefs = await this.client.getAccountPreferences();
    const market = (prefs.market ?? []).map((m) => ({
      marginType: normalizeMarginType(m.marginType),
      setLeverage: m.setLeverage ?? 1,
    }));
    return { market };
  }

  toMarketCoinType(baseAsset: string): string {
    return toBluefinCoinType(baseAsset);
  }

  async seedCoinMetadata(repo: CoinMetadataRepository, chainId: ChainId): Promise<void> {
    const markets = await this.getMarkets();
    seedSyntheticCoinMetadata(markets, repo, chainId);
  }

  async syncFills(
    activityLog: ActivityLog,
    coinMetadataRepo: CoinMetadataRepository,
    chainId: ChainId,
    walletAddress: string,
    logger: Logger,
  ): Promise<{ synced: number }> {
    return syncFills(this.client, activityLog, coinMetadataRepo, chainId, walletAddress, logger);
  }

  enrichError(message: string): string {
    if (message.includes('status code 400')) {
      return `${message}. No Bluefin margin account found -- deposit first with: fence perp deposit <amount>`;
    }
    return message;
  }

  async dispose(): Promise<void> {
    await this.client.dispose();
  }
}

function normalizeMarginType(raw: string | undefined): 'CROSS' | 'ISOLATED' | 'UNSPECIFIED' {
  if (raw === 'CROSS') return 'CROSS';
  if (raw === 'ISOLATED') return 'ISOLATED';
  return 'UNSPECIFIED';
}

function mapPosition(p: Position): PerpPosition {
  return {
    symbol: p.symbol,
    side: p.side === 'SHORT' ? 'SHORT' : 'LONG',
    sizeE9: p.sizeE9,
    entryPriceE9: p.avgEntryPriceE9,
    markPriceE9: p.markPriceE9,
    unrealizedPnlE9: p.unrealizedPnlE9,
    leverageE9: p.clientSetLeverageE9,
    marginType: p.isIsolated ? 'ISOLATED' : 'CROSS',
  };
}

function mapOpenOrder(o: OpenOrderResponse): PerpOpenOrder {
  return {
    orderHash: o.orderHash,
    clientOrderId: o.clientOrderId,
    symbol: o.symbol,
    side: o.side,
    priceE9: o.priceE9,
    quantityE9: o.quantityE9,
    filledQuantityE9: o.filledQuantityE9,
    leverageE9: o.leverageE9,
    type: o.type,
    timeInForce: o.timeInForce,
    reduceOnly: o.reduceOnly,
    status: o.status,
  };
}
