import { describe, expect, it, vi } from 'vitest';
import type {
  BluefinClient,
  ExchangeInfoResponse,
  Market,
} from '../chain/sui/bluefin-pro/client.js';
import {
  fetchBluefinMarkets,
  resolveMarketSymbol,
  seedSyntheticCoinMetadata,
} from '../chain/sui/bluefin-pro/markets.js';
import { BLUEFIN_DECIMALS, toBluefinCoinType } from '../chain/sui/bluefin-pro/types.js';
import type { CoinMetadataRepository } from '../db/coin-metadata-repo.js';

function makeMockMarket(symbol: string, overrides?: Partial<Market>): Market {
  return {
    symbol,
    status: 'ACTIVE',
    minOrderQuantityE9: '100000000',
    maxLimitOrderQuantityE9: '100000000000000',
    tickSizeE9: '100000000',
    stepSizeE9: '100000000',
    defaultLeverageE9: '3000000000',
    defaultMakerFeeE9: '200000',
    defaultTakerFeeE9: '500000',
    maxNotionalAtOpenE9: ['1000000000000', '500000000000', '250000000000'],
    ...overrides,
  } as Market;
}

function makeMockClient(markets: Market[]): BluefinClient {
  return {
    getExchangeInfo: vi.fn().mockResolvedValue({ markets } as ExchangeInfoResponse),
  } as unknown as BluefinClient;
}

describe('fetchBluefinMarkets', () => {
  it('fetches and normalizes market info', async () => {
    const client = makeMockClient([makeMockMarket('BTC-PERP'), makeMockMarket('ETH-PERP')]);

    const markets = await fetchBluefinMarkets(client);

    expect(markets).toHaveLength(2);
    expect(markets[0]!.symbol).toBe('BTC-PERP');
    expect(markets[0]!.baseAsset).toBe('BTC');
    expect(markets[0]!.status).toBe('ACTIVE');
    expect(markets[0]!.minOrderSizeE9).toBe('100000000');
    expect(markets[0]!.maxOrderSizeE9).toBe('100000000000000');
    expect(markets[0]!.tickSizeE9).toBe('100000000');
    expect(markets[0]!.stepSizeE9).toBe('100000000');
    expect(markets[0]!.defaultLeverageE9).toBe('3000000000');
    expect(markets[0]!.makerFeeE9).toBe('200000');
    expect(markets[0]!.takerFeeE9).toBe('500000');
    expect(markets[1]!.symbol).toBe('ETH-PERP');
    expect(markets[1]!.baseAsset).toBe('ETH');
  });

  it('computes maxLeverageE9 from maxNotionalAtOpenE9 array length', async () => {
    const client = makeMockClient([
      makeMockMarket('BTC-PERP', {
        maxNotionalAtOpenE9: ['a', 'b', 'c', 'd', 'e'],
      }),
    ]);

    const markets = await fetchBluefinMarkets(client);
    expect(markets[0]!.maxLeverageE9).toBe('5000000000');
  });

  it('returns empty array when no markets available', async () => {
    const client = makeMockClient([]);
    const markets = await fetchBluefinMarkets(client);
    expect(markets).toEqual([]);
  });
});

describe('seedSyntheticCoinMetadata', () => {
  it('calls upsertBulk with correct synthetic coin rows', () => {
    const mockRepo = {
      upsertBulk: vi.fn(),
    } as unknown as CoinMetadataRepository;

    const markets = [
      { symbol: 'BTC-PERP', baseAsset: 'BTC', status: 'ACTIVE' },
      { symbol: 'ETH-PERP', baseAsset: 'ETH', status: 'ACTIVE' },
    ] as any;

    seedSyntheticCoinMetadata(markets, mockRepo, 'sui:mainnet');

    expect(mockRepo.upsertBulk).toHaveBeenCalledOnce();
    const rows = (mockRepo.upsertBulk as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      coin_type: toBluefinCoinType('BTC'),
      chain_id: 'sui:mainnet',
      symbol: 'BTC',
      name: 'Bluefin Pro BTC-PERP',
      decimals: BLUEFIN_DECIMALS,
    });
    expect(rows[1]).toEqual({
      coin_type: toBluefinCoinType('ETH'),
      chain_id: 'sui:mainnet',
      symbol: 'ETH',
      name: 'Bluefin Pro ETH-PERP',
      decimals: BLUEFIN_DECIMALS,
    });
  });

  it('handles empty markets list', () => {
    const mockRepo = {
      upsertBulk: vi.fn(),
    } as unknown as CoinMetadataRepository;

    seedSyntheticCoinMetadata([], mockRepo, 'sui:mainnet');
    expect(mockRepo.upsertBulk).toHaveBeenCalledWith([]);
  });
});

describe('resolveMarketSymbol', () => {
  const markets = [
    { symbol: 'BTC-PERP', baseAsset: 'BTC', status: 'ACTIVE' },
    { symbol: 'ETH-PERP', baseAsset: 'ETH', status: 'ACTIVE' },
  ] as any;

  it('resolves exact match', () => {
    expect(resolveMarketSymbol(markets, 'BTC-PERP')).toBe('BTC-PERP');
  });

  it('resolves case-insensitive match', () => {
    expect(resolveMarketSymbol(markets, 'btc-perp')).toBe('BTC-PERP');
    expect(resolveMarketSymbol(markets, 'Eth-Perp')).toBe('ETH-PERP');
  });

  it('throws on unknown market', () => {
    expect(() => resolveMarketSymbol(markets, 'SOL-PERP')).toThrow(/Unknown Bluefin market/i);
  });

  it('includes available markets in error message', () => {
    expect(() => resolveMarketSymbol(markets, 'SOL-PERP')).toThrow(/BTC-PERP.*ETH-PERP/);
  });

  it('throws on empty input', () => {
    expect(() => resolveMarketSymbol(markets, '')).toThrow();
  });
});
