import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PriceCache, OracleStalePriceError } from '../../core/price-cache.js';
import type { DataProvider, TokenMetadata } from '../../core/data-provider.js';
import type { Chain } from '../../core/action-types.js';

function createMockProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  return {
    chain: 'sui' as Chain,
    getPrice: vi.fn().mockResolvedValue(1.5),
    getPrices: vi.fn().mockResolvedValue({}),
    getMetadata: vi.fn().mockResolvedValue({ symbol: 'SUI', decimals: 9, address: '0x2' }),
    getMetadatas: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe('PriceCache', () => {
  let mockProvider: DataProvider;

  beforeEach(() => {
    mockProvider = createMockProvider();
  });

  it('returns fresh price from provider and caches it', async () => {
    const cache = new PriceCache(mockProvider);

    const price = await cache.getPrice('0xtoken');
    expect(price).toBe(1.5);
    expect(mockProvider.getPrice).toHaveBeenCalledWith('0xtoken');
  });

  it('returns cached price when provider fails within TTL', async () => {
    const cache = new PriceCache(mockProvider, 60_000); // 1 min TTL

    // First call succeeds and caches
    await cache.getPrice('0xtoken');

    // Second call fails — should use cache
    vi.mocked(mockProvider.getPrice).mockRejectedValueOnce(new Error('network error'));
    const price = await cache.getPrice('0xtoken');
    expect(price).toBe(1.5);
  });

  it('throws OracleStalePriceError when provider fails and cache is stale', async () => {
    const cache = new PriceCache(mockProvider, 100); // 100ms TTL

    // First call succeeds
    await cache.getPrice('0xtoken');

    // Wait for cache to become stale
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Provider fails — cache is stale — should throw
    vi.mocked(mockProvider.getPrice).mockRejectedValueOnce(new Error('network error'));

    await expect(cache.getPrice('0xtoken')).rejects.toThrow(OracleStalePriceError);
  });

  it('throws OracleStalePriceError when provider fails and no cache exists', async () => {
    const failingProvider = createMockProvider({
      getPrice: vi.fn().mockRejectedValue(new Error('network error')),
    });
    const cache = new PriceCache(failingProvider);

    await expect(cache.getPrice('0xtoken')).rejects.toThrow(OracleStalePriceError);
  });

  it('delegates metadata calls directly to inner provider', async () => {
    const cache = new PriceCache(mockProvider);

    const meta = await cache.getMetadata('0xtoken');
    expect(meta.symbol).toBe('SUI');
    expect(mockProvider.getMetadata).toHaveBeenCalledWith('0xtoken');
  });

  it('handles getPrices with fail-closed on batch', async () => {
    const cache = new PriceCache(mockProvider, 60_000);

    // Pre-cache a price
    vi.mocked(mockProvider.getPrice).mockResolvedValueOnce(2.0);
    await cache.getPrice('0xa');

    // Batch fails — should fall back to individual cache lookups
    vi.mocked(mockProvider.getPrices).mockRejectedValueOnce(new Error('batch error'));

    const prices = await cache.getPrices(['0xa']);
    expect(prices['0xa']).toBe(2.0);
  });

  it('throws on getPrices when cache is missing for any address', async () => {
    const failingProvider = createMockProvider({
      getPrices: vi.fn().mockRejectedValue(new Error('batch error')),
    });
    const cache = new PriceCache(failingProvider);

    await expect(cache.getPrices(['0xuncached'])).rejects.toThrow(OracleStalePriceError);
  });
});
