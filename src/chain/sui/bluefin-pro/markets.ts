import type { ChainId } from '../../../core/action-types.js';
import type { CoinMetadataRepository } from '../../../db/coin-metadata-repo.js';
import type { BluefinClient, Market } from './client.js';
import { BLUEFIN_DECIMALS, parseBluefinMarketSymbol, toBluefinCoinType } from './types.js';

export interface BluefinMarketInfo {
  readonly symbol: string;
  readonly baseAsset: string;
  readonly status: string;
  readonly minOrderSizeE9: string;
  readonly maxOrderSizeE9: string;
  readonly tickSizeE9: string;
  readonly stepSizeE9: string;
  readonly defaultLeverageE9: string;
  readonly maxLeverageE9: string;
  readonly makerFeeE9: string;
  readonly takerFeeE9: string;
}

function marketToInfo(market: Market): BluefinMarketInfo {
  const baseAsset = parseBluefinMarketSymbol(market.symbol);
  // maxNotionalAtOpenE9 is an array with one entry per leverage tier (1x, 2x, ..., Nx).
  // The array length equals the maximum leverage the market supports.
  const maxLeverage = market.maxNotionalAtOpenE9.length;
  return {
    symbol: market.symbol,
    baseAsset,
    status: market.status,
    minOrderSizeE9: market.minOrderQuantityE9,
    maxOrderSizeE9: market.maxLimitOrderQuantityE9,
    tickSizeE9: market.tickSizeE9,
    stepSizeE9: market.stepSizeE9,
    defaultLeverageE9: market.defaultLeverageE9,
    maxLeverageE9: `${maxLeverage}000000000`,
    makerFeeE9: market.defaultMakerFeeE9,
    takerFeeE9: market.defaultTakerFeeE9,
  };
}

/**
 * Fetch all available markets from Bluefin Pro and return normalized info.
 */
export async function fetchBluefinMarkets(client: BluefinClient): Promise<BluefinMarketInfo[]> {
  const exchangeInfo = await client.getExchangeInfo();
  return exchangeInfo.markets.map(marketToInfo);
}

/**
 * Seed the coin_metadata table with synthetic coin entries for each Bluefin market.
 * Uses upsert so it's safe to call multiple times.
 */
export function seedSyntheticCoinMetadata(
  markets: readonly BluefinMarketInfo[],
  repo: CoinMetadataRepository,
  chainId: ChainId,
): void {
  const rows = markets.map((m) => ({
    coin_type: toBluefinCoinType(m.baseAsset),
    chain_id: chainId,
    symbol: m.baseAsset,
    name: `Bluefin Pro ${m.baseAsset}-PERP`,
    decimals: BLUEFIN_DECIMALS,
  }));
  repo.upsertBulk(rows);
}

/**
 * Resolve and validate a market symbol against the available markets.
 * Accepts case-insensitive input (e.g. 'btc-perp' → 'BTC-PERP').
 * Throws if the market is not found.
 */
export function resolveMarketSymbol(
  markets: readonly BluefinMarketInfo[],
  rawSymbol: string,
): string {
  const normalized = rawSymbol.toUpperCase();
  const found = markets.find((m) => m.symbol === normalized);
  if (found === undefined) {
    const available = markets.map((m) => m.symbol).join(', ');
    throw new Error(`Unknown Bluefin market "${rawSymbol}". Available markets: ${available}`);
  }
  return found.symbol;
}
