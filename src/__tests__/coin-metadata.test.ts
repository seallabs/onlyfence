import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NoodlesCoinMetadataService } from '../data/coin-metadata.js';

describe('NoodlesCoinMetadataService', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockFetch.mockReset();
  });

  const knownDecimals: Readonly<Record<string, number>> = {
    '0x2::sui::SUI': 9,
    '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': 6,
  };

  /** Helper: mock a successful coin-list response. */
  function mockCoinListResponse(
    data: ReadonlyArray<{ coin_type: string; symbol?: string; decimals: number }>,
  ): void {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 200, data }),
    });
  }

  it('fetches decimals from API on cache miss', async () => {
    mockCoinListResponse([{ coin_type: '0x2::sui::SUI', symbol: 'SUI', decimals: 9 }]);

    const service = new NoodlesCoinMetadataService(knownDecimals);
    const decimals = await service.getDecimals('0x2::sui::SUI', 'sui');

    expect(decimals).toBe(9);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('returns cached result on second call', async () => {
    mockCoinListResponse([{ coin_type: '0x2::sui::SUI', symbol: 'SUI', decimals: 9 }]);

    const service = new NoodlesCoinMetadataService(knownDecimals);
    await service.getDecimals('0x2::sui::SUI', 'sui');
    const decimals = await service.getDecimals('0x2::sui::SUI', 'sui');

    expect(decimals).toBe(9);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('falls back to known decimals when API fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const service = new NoodlesCoinMetadataService(knownDecimals);
    const decimals = await service.getDecimals('0x2::sui::SUI', 'sui');

    expect(decimals).toBe(9);
  });

  it('falls back to known decimals on non-200 API response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const service = new NoodlesCoinMetadataService(knownDecimals);
    const decimals = await service.getDecimals('0x2::sui::SUI', 'sui');

    expect(decimals).toBe(9);
  });

  it('throws when API fails and no local fallback exists', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const service = new NoodlesCoinMetadataService(knownDecimals);
    await expect(service.getDecimals('0xunknown::foo::BAR', 'sui')).rejects.toThrow(
      'Cannot resolve decimals for coin type "0xunknown::foo::BAR"',
    );
  });

  it('returns full metadata from API', async () => {
    const coinType =
      '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
    mockCoinListResponse([{ coin_type: coinType, symbol: 'USDC', decimals: 6 }]);

    const service = new NoodlesCoinMetadataService(knownDecimals);
    const meta = await service.getMetadata(coinType, 'sui');

    expect(meta).toEqual({
      coinType,
      symbol: 'USDC',
      decimals: 6,
    });
  });

  it('extracts symbol from coin type in fallback', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const service = new NoodlesCoinMetadataService(knownDecimals);
    const meta = await service.getMetadata('0x2::sui::SUI', 'sui');

    expect(meta.symbol).toBe('SUI');
    expect(meta.decimals).toBe(9);
  });

  it('uses POST method with correct body and headers (with API key)', async () => {
    mockCoinListResponse([{ coin_type: '0x2::sui::SUI', symbol: 'SUI', decimals: 9 }]);

    const service = new NoodlesCoinMetadataService(
      knownDecimals,
      'my-api-key',
      'https://custom.api',
    );
    await service.getDecimals('0x2::sui::SUI', 'sui');

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://custom.api/api/v1/partner/coin-list');
    expect(options.method).toBe('POST');

    const headers = options.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('my-api-key');
    expect(headers['x-chain']).toBe('sui');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body as string) as {
      pagination: { limit: number; offset: number };
      filters: { coin_ids: string[] };
    };
    expect(body.filters.coin_ids).toEqual(['0x2::sui::SUI']);
    expect(body.pagination).toEqual({ limit: 1, offset: 0 });
  });

  it('omits x-api-key header when no API key is provided', async () => {
    mockCoinListResponse([{ coin_type: '0x2::sui::SUI', symbol: 'SUI', decimals: 9 }]);

    const service = new NoodlesCoinMetadataService(knownDecimals);
    await service.getDecimals('0x2::sui::SUI', 'sui');

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers['x-chain']).toBe('sui');
  });

  it('prefetch populates cache for multiple coin types', async () => {
    const suiType = '0x2::sui::SUI';
    const usdcType =
      '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

    mockCoinListResponse([
      { coin_type: suiType, symbol: 'SUI', decimals: 9 },
      { coin_type: usdcType, symbol: 'USDC', decimals: 6 },
    ]);

    const service = new NoodlesCoinMetadataService(knownDecimals, 'test-key');
    await service.prefetch([suiType, usdcType], 'sui');

    // Should not trigger additional fetch calls — data is cached
    const suiMeta = await service.getMetadata(suiType, 'sui');
    const usdcMeta = await service.getMetadata(usdcType, 'sui');

    expect(suiMeta).toEqual({ coinType: suiType, symbol: 'SUI', decimals: 9 });
    expect(usdcMeta).toEqual({ coinType: usdcType, symbol: 'USDC', decimals: 6 });
    expect(mockFetch).toHaveBeenCalledOnce(); // only the prefetch call
  });

  it('prefetch skips already-cached coin types', async () => {
    // First call caches SUI
    mockCoinListResponse([{ coin_type: '0x2::sui::SUI', symbol: 'SUI', decimals: 9 }]);
    const service = new NoodlesCoinMetadataService(knownDecimals, 'test-key');
    await service.getDecimals('0x2::sui::SUI', 'sui');

    // Prefetch with SUI (cached) + USDC (uncached) — should only request USDC
    const usdcType =
      '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
    mockCoinListResponse([{ coin_type: usdcType, symbol: 'USDC', decimals: 6 }]);
    await service.prefetch(['0x2::sui::SUI', usdcType], 'sui');

    const [, options] = mockFetch.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as {
      filters: { coin_ids: string[] };
    };
    expect(body.filters.coin_ids).toEqual([usdcType]);
  });

  it('prefetch does not call API when all types are cached', async () => {
    mockCoinListResponse([{ coin_type: '0x2::sui::SUI', symbol: 'SUI', decimals: 9 }]);
    const service = new NoodlesCoinMetadataService(knownDecimals, 'test-key');
    await service.getDecimals('0x2::sui::SUI', 'sui');

    // All already cached — no new fetch expected
    await service.prefetch(['0x2::sui::SUI'], 'sui');
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
