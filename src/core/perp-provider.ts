import type { Logger } from 'pino';
import type { ActivityLog } from '../db/activity-log.js';
import type { CoinMetadataRepository } from '../db/coin-metadata-repo.js';
import type { ChainId, PerpProtocol } from './action-types.js';

/** Market info returned by any perp provider. */
export interface PerpMarketInfo {
  readonly symbol: string;
  readonly baseAsset: string;
  readonly status: string;
  readonly minOrderSizeE9: string;
  readonly maxOrderSizeE9: string;
  readonly tickSizeE9: string;
  readonly stepSizeE9: string;
  readonly defaultLeverageE9: string;
  readonly maxLeverageE9: string;
  readonly minOrderPriceE9: string;
  readonly maxOrderPriceE9: string;
  readonly makerFeeE9: string;
  readonly takerFeeE9: string;
}

/** Account preferences (leverage per market, etc.) */
export interface PerpAccountPreferences {
  readonly market: readonly {
    readonly marginType: 'CROSS' | 'ISOLATED' | 'UNSPECIFIED';
    readonly setLeverage: number;
  }[];
}

/** Pagination/filter params for queries. */
export interface PerpQueryParams {
  readonly limit?: number;
  readonly startTimeAtMillis?: number;
  readonly endTimeAtMillis?: number;
  readonly page?: number;
}

// ── Protocol-neutral DTOs for query results ────────────────────────────────

/** Standardized account summary across all perp protocols. */
export interface PerpAccount {
  readonly accountAddress: string;
  readonly marginBalanceE9: string;
  readonly freeMarginE9: string;
  readonly accountValueE9: string;
  readonly unrealizedPnlE9: string;
  readonly positions: readonly PerpPosition[];
  /** Protocol-specific extra fields. Consumers should not depend on these. */
  readonly extra?: Record<string, unknown>;
}

/** Standardized open position. */
export interface PerpPosition {
  readonly symbol: string;
  readonly side: 'LONG' | 'SHORT';
  readonly sizeE9: string;
  readonly entryPriceE9: string;
  readonly markPriceE9: string;
  readonly unrealizedPnlE9: string;
  readonly leverageE9: string;
  readonly marginType: 'CROSS' | 'ISOLATED';
  readonly extra?: Record<string, unknown>;
}

/** Standardized open order. */
export interface PerpOpenOrder {
  readonly orderHash: string;
  readonly clientOrderId?: string | undefined;
  readonly symbol: string;
  readonly side: string;
  readonly priceE9: string;
  readonly quantityE9: string;
  readonly filledQuantityE9: string;
  readonly leverageE9: string;
  readonly type: string;
  readonly timeInForce: string;
  readonly reduceOnly: boolean;
  readonly status: string;
  readonly extra?: Record<string, unknown>;
}

/** Standardized trade / fill record. */
export interface PerpTrade {
  readonly id: string;
  readonly symbol: string;
  readonly orderHash: string;
  readonly side: string;
  readonly priceE9: string;
  readonly quantityE9: string;
  readonly feeE9: string;
  readonly realizedPnlE9?: string | undefined;
  readonly isMaker: boolean;
  readonly extra?: Record<string, unknown>;
}

/** Standardized funding rate entry. */
export interface PerpFundingRateEntry {
  readonly symbol: string;
  readonly fundingRateE9: string;
  readonly fundingTimeAtMillis: number;
  /** Hours between each funding settlement (e.g., 1 for hourly, 8 for 8h). */
  readonly fundingIntervalHours: number;
}

/** Standardized account funding payment. */
export interface PerpFundingPayment {
  readonly symbol: string;
  readonly paymentAmountE9: string;
  readonly rateE9: string;
  readonly positionSide: string;
  readonly executedAtMillis?: number | undefined;
}

// ── PerpProvider interface ─────────────────────────────────────────────────

/**
 * Protocol-abstract interface for perpetual futures exchanges.
 * Each perp protocol (Bluefin Pro, etc.) implements this interface.
 * The CLI and pipeline use this interface — never protocol-specific types directly.
 */
export interface PerpProvider {
  readonly protocol: PerpProtocol;

  /** Get all available markets. */
  getMarkets(): Promise<PerpMarketInfo[]>;

  /** Resolve and validate a market symbol (case-insensitive). Throws if not found. */
  resolveMarket(rawSymbol: string): Promise<string>;

  /** Get account details (balance, margin, positions). */
  getAccount(): Promise<PerpAccount>;

  /** Get open positions. */
  getPositions(): Promise<readonly PerpPosition[]>;

  /** Get open orders, optionally filtered by market. */
  getOpenOrders(symbol?: string): Promise<readonly PerpOpenOrder[]>;

  /** Get standby orders (stop-loss, take-profit), optionally filtered by market. */
  getStandbyOrders(symbol?: string): Promise<readonly PerpOpenOrder[]>;

  /** Get trade history. */
  getTrades(params?: PerpQueryParams & { symbol?: string }): Promise<readonly PerpTrade[]>;

  /** Get exchange-level funding rate history for a market. */
  getFundingRateHistory(
    symbol: string,
    params?: PerpQueryParams,
  ): Promise<readonly PerpFundingRateEntry[]>;

  /** Get account-level funding payment history. */
  getAccountFundingHistory(params?: PerpQueryParams): Promise<readonly PerpFundingPayment[]>;

  /** Get account preferences (leverage per market). */
  getAccountPreferences(): Promise<PerpAccountPreferences>;

  /** Generate the synthetic coin type for a market base asset. */
  toMarketCoinType(baseAsset: string): string;

  /** Seed synthetic coin metadata for all markets. */
  seedCoinMetadata(repo: CoinMetadataRepository, chainId: ChainId): Promise<void>;

  /** Sync filled trades from exchange into activities table. */
  syncFills(
    activityLog: ActivityLog,
    coinMetadataRepo: CoinMetadataRepository,
    chainId: ChainId,
    walletAddress: string,
    logger: Logger,
  ): Promise<{ synced: number }>;

  /** Enrich error messages with protocol-specific hints. */
  enrichError(message: string): string;

  /** Dispose resources. */
  dispose(): Promise<void>;
}

/** Registry of PerpProviders keyed by protocol name. */
export class PerpProviderRegistry {
  private readonly providers = new Map<PerpProtocol, PerpProvider>();

  register(provider: PerpProvider): void {
    if (this.providers.has(provider.protocol)) {
      throw new Error(`PerpProviderRegistry: protocol "${provider.protocol}" already registered`);
    }
    this.providers.set(provider.protocol, provider);
  }

  get(protocol: PerpProtocol): PerpProvider {
    const provider = this.providers.get(protocol);
    if (provider === undefined) {
      const available = [...this.providers.keys()].join(', ');
      throw new Error(
        `PerpProviderRegistry: no provider for "${protocol}". Available: ${available}`,
      );
    }
    return provider;
  }

  getDefault(): PerpProvider {
    const first = this.providers.values().next();
    if (first.done === true) {
      throw new Error('PerpProviderRegistry: no providers registered');
    }
    return first.value;
  }

  has(protocol: PerpProtocol): boolean {
    return this.providers.has(protocol);
  }

  /** Dispose all registered providers. Continues on failure so all get a chance to clean up. */
  async disposeAll(): Promise<void> {
    const errors: Error[] = [];
    for (const provider of this.providers.values()) {
      try {
        await provider.dispose();
      } catch (e: unknown) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Failed to dispose one or more perp providers');
    }
  }
}
