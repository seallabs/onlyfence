import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DataProvider, TokenMetadata } from '../core/data-provider.js';
import { DataProviderWithCache } from '../core/data-provider.js';
import { CoinMetadataRepository } from '../db/coin-metadata-repo.js';
import { openMemoryDatabase } from '../db/connection.js';
import type Database from 'better-sqlite3';

function createMockProvider(overrides?: Partial<DataProvider>): DataProvider {
  return {
    chain: 'sui',
    getPrice: vi.fn().mockResolvedValue(3.5),
    getPrices: vi.fn().mockResolvedValue({ '0x2::sui::SUI': 3.5 }),
    getMetadata: vi.fn().mockResolvedValue({
      address: '0x2::sui::SUI',
      symbol: 'SUI',
      decimals: 9,
    } satisfies TokenMetadata),
    getMetadatas: vi.fn().mockResolvedValue({
      '0x2::sui::SUI': { address: '0x2::sui::SUI', symbol: 'SUI', decimals: 9 },
    } satisfies Record<string, TokenMetadata>),
    ...overrides,
  };
}

describe('DataProviderWithCache', () => {
  let db: Database.Database;
  let repo: CoinMetadataRepository;
  let inner: DataProvider;
  let provider: DataProviderWithCache;

  beforeEach(() => {
    db = openMemoryDatabase();
    repo = new CoinMetadataRepository(db);
    inner = createMockProvider();
    provider = new DataProviderWithCache(inner, repo);
  });

  it('exposes the inner provider chain', () => {
    expect(provider.chain).toBe('sui');
  });

  describe('getPrice', () => {
    it('delegates to inner provider (no caching)', async () => {
      const price = await provider.getPrice('0x2::sui::SUI');
      expect(price).toBe(3.5);
      expect(inner.getPrice).toHaveBeenCalledWith('0x2::sui::SUI');
    });
  });

  describe('getPrices', () => {
    it('delegates to inner provider (no caching)', async () => {
      const prices = await provider.getPrices(['0x2::sui::SUI']);
      expect(prices).toEqual({ '0x2::sui::SUI': 3.5 });
      expect(inner.getPrices).toHaveBeenCalledWith(['0x2::sui::SUI']);
    });
  });

  describe('getMetadata', () => {
    it('returns from DB without calling inner when cached', async () => {
      repo.upsert({
        coin_type: '0x2::sui::SUI',
        chain_id: 'sui',
        symbol: 'SUI',
        name: null,
        decimals: 9,
      });

      const result = await provider.getMetadata('0x2::sui::SUI');

      expect(result).toEqual({ address: '0x2::sui::SUI', symbol: 'SUI', decimals: 9 });
      expect(inner.getMetadata).not.toHaveBeenCalled();
    });

    it('delegates to inner on DB miss and backfills DB', async () => {
      const result = await provider.getMetadata('0x2::sui::SUI');

      expect(result).toEqual({ address: '0x2::sui::SUI', symbol: 'SUI', decimals: 9 });
      expect(inner.getMetadata).toHaveBeenCalledWith('0x2::sui::SUI');

      // Verify backfill
      const cached = repo.get('0x2::sui::SUI', 'sui');
      expect(cached).not.toBeNull();
      expect(cached!.decimals).toBe(9);
      expect(cached!.symbol).toBe('SUI');
    });

    it('propagates errors from inner provider', async () => {
      inner = createMockProvider({
        getMetadata: vi.fn().mockRejectedValue(new Error('API down')),
      });
      provider = new DataProviderWithCache(inner, repo);

      await expect(provider.getMetadata('0xunknown::foo::BAR')).rejects.toThrow('API down');
    });
  });

  describe('getMetadatas', () => {
    it('returns empty object for empty input', async () => {
      const result = await provider.getMetadatas([]);
      expect(result).toEqual({});
      expect(inner.getMetadatas).not.toHaveBeenCalled();
    });

    it('returns all from DB when fully cached', async () => {
      repo.upsert({
        coin_type: '0x2::sui::SUI',
        chain_id: 'sui',
        symbol: 'SUI',
        name: null,
        decimals: 9,
      });
      repo.upsert({
        coin_type: '0xdba3::usdc::USDC',
        chain_id: 'sui',
        symbol: 'USDC',
        name: null,
        decimals: 6,
      });

      const result = await provider.getMetadatas(['0x2::sui::SUI', '0xdba3::usdc::USDC']);

      expect(result).toEqual({
        '0x2::sui::SUI': { address: '0x2::sui::SUI', symbol: 'SUI', decimals: 9 },
        '0xdba3::usdc::USDC': { address: '0xdba3::usdc::USDC', symbol: 'USDC', decimals: 6 },
      });
      expect(inner.getMetadatas).not.toHaveBeenCalled();
    });

    it('fetches only uncached addresses and backfills DB', async () => {
      // Pre-cache SUI
      repo.upsert({
        coin_type: '0x2::sui::SUI',
        chain_id: 'sui',
        symbol: 'SUI',
        name: null,
        decimals: 9,
      });

      const usdcMeta: TokenMetadata = {
        address: '0xdba3::usdc::USDC',
        symbol: 'USDC',
        decimals: 6,
      };
      inner = createMockProvider({
        getMetadatas: vi.fn().mockResolvedValue({ '0xdba3::usdc::USDC': usdcMeta }),
      });
      provider = new DataProviderWithCache(inner, repo);

      const result = await provider.getMetadatas(['0x2::sui::SUI', '0xdba3::usdc::USDC']);

      // SUI from cache, USDC from inner
      expect(result['0x2::sui::SUI']).toEqual({
        address: '0x2::sui::SUI',
        symbol: 'SUI',
        decimals: 9,
      });
      expect(result['0xdba3::usdc::USDC']).toEqual(usdcMeta);

      // Inner only called with uncached
      expect(inner.getMetadatas).toHaveBeenCalledWith(['0xdba3::usdc::USDC']);

      // USDC backfilled in DB
      const cached = repo.get('0xdba3::usdc::USDC', 'sui');
      expect(cached).not.toBeNull();
      expect(cached!.decimals).toBe(6);
    });

    it('propagates errors from inner provider', async () => {
      inner = createMockProvider({
        getMetadatas: vi.fn().mockRejectedValue(new Error('API down')),
      });
      provider = new DataProviderWithCache(inner, repo);

      await expect(provider.getMetadatas(['0xunknown::foo::BAR'])).rejects.toThrow('API down');
    });
  });
});
