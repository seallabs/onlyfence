import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openMemoryDatabase } from '../db/connection.js';
import { CoinMetadataRepository } from '../db/coin-metadata-repo.js';
import { CachedCoinMetadataService } from '../data/cached-coin-metadata.js';
import type { CoinMetadataService, CoinMetadata } from '../data/coin-metadata.js';
import type Database from 'better-sqlite3';

function createMockInner(overrides?: Partial<CoinMetadataService>): CoinMetadataService {
  return {
    getDecimals: vi.fn().mockResolvedValue(9),
    getMetadata: vi.fn().mockResolvedValue({
      coinType: '0x2::sui::SUI',
      symbol: 'SUI',
      decimals: 9,
    } satisfies CoinMetadata),
    prefetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('CachedCoinMetadataService', () => {
  let db: Database.Database;
  let repo: CoinMetadataRepository;
  let inner: CoinMetadataService;
  let service: CachedCoinMetadataService;

  beforeEach(() => {
    db = openMemoryDatabase();
    repo = new CoinMetadataRepository(db);
    inner = createMockInner();
    service = new CachedCoinMetadataService(repo, inner);
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

      const result = await service.getMetadata('0x2::sui::SUI', 'sui');

      expect(result).toEqual({ coinType: '0x2::sui::SUI', symbol: 'SUI', decimals: 9 });
      expect(inner.getMetadata).not.toHaveBeenCalled();
    });

    it('delegates to inner on DB miss and backfills DB', async () => {
      const result = await service.getMetadata('0x2::sui::SUI', 'sui');

      expect(result).toEqual({ coinType: '0x2::sui::SUI', symbol: 'SUI', decimals: 9 });
      expect(inner.getMetadata).toHaveBeenCalledWith('0x2::sui::SUI', 'sui');

      // Verify backfill
      const cached = repo.get('0x2::sui::SUI', 'sui');
      expect(cached).not.toBeNull();
      expect(cached!.decimals).toBe(9);
    });

    it('propagates errors from inner (no silent failures)', async () => {
      inner = createMockInner({
        getMetadata: vi.fn().mockRejectedValue(new Error('API down')),
      });
      service = new CachedCoinMetadataService(repo, inner);

      await expect(service.getMetadata('0xunknown::foo::BAR', 'sui')).rejects.toThrow('API down');
    });
  });

  describe('getDecimals', () => {
    it('returns decimals via getMetadata', async () => {
      repo.upsert({
        coin_type: '0x2::sui::SUI',
        chain_id: 'sui',
        symbol: 'SUI',
        name: null,
        decimals: 9,
      });

      const decimals = await service.getDecimals('0x2::sui::SUI', 'sui');
      expect(decimals).toBe(9);
    });
  });

  describe('prefetch', () => {
    it('skips coins already in DB and fetches only uncached', async () => {
      repo.upsert({
        coin_type: '0x2::sui::SUI',
        chain_id: 'sui',
        symbol: 'SUI',
        name: null,
        decimals: 9,
      });

      const usdcMeta: CoinMetadata = {
        coinType: '0xdba3::usdc::USDC',
        symbol: 'USDC',
        decimals: 6,
      };
      inner = createMockInner({
        getMetadata: vi.fn().mockResolvedValue(usdcMeta),
        prefetch: vi.fn(),
      });
      service = new CachedCoinMetadataService(repo, inner);

      await service.prefetch(['0x2::sui::SUI', '0xdba3::usdc::USDC'], 'sui');

      // Inner should only be called for USDC (SUI is cached)
      expect(inner.getMetadata).toHaveBeenCalledTimes(1);
      expect(inner.getMetadata).toHaveBeenCalledWith('0xdba3::usdc::USDC', 'sui');

      // USDC should now be in DB
      const cached = repo.get('0xdba3::usdc::USDC', 'sui');
      expect(cached).not.toBeNull();
      expect(cached!.decimals).toBe(6);
    });

    it('does nothing when all coins are cached', async () => {
      repo.upsert({
        coin_type: '0x2::sui::SUI',
        chain_id: 'sui',
        symbol: 'SUI',
        name: null,
        decimals: 9,
      });

      await service.prefetch(['0x2::sui::SUI'], 'sui');

      expect(inner.getMetadata).not.toHaveBeenCalled();
    });
  });
});
