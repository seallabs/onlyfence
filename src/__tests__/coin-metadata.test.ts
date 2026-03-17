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

  it('fetches decimals from API on cache miss', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 200,
        data: { coin: { symbol: 'SUI', decimals: 9, coin_type: '0x2::sui::SUI' } },
      }),
    });

    const service = new NoodlesCoinMetadataService('test-key', knownDecimals);
    const decimals = await service.getDecimals('0x2::sui::SUI', 'sui');

    expect(decimals).toBe(9);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('returns cached result on second call', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 200,
        data: { coin: { symbol: 'SUI', decimals: 9 } },
      }),
    });

    const service = new NoodlesCoinMetadataService('test-key', knownDecimals);
    await service.getDecimals('0x2::sui::SUI', 'sui');
    const decimals = await service.getDecimals('0x2::sui::SUI', 'sui');

    expect(decimals).toBe(9);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('falls back to known decimals when API fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const service = new NoodlesCoinMetadataService('test-key', knownDecimals);
    const decimals = await service.getDecimals('0x2::sui::SUI', 'sui');

    expect(decimals).toBe(9);
  });

  it('falls back to known decimals on non-200 API response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const service = new NoodlesCoinMetadataService('test-key', knownDecimals);
    const decimals = await service.getDecimals('0x2::sui::SUI', 'sui');

    expect(decimals).toBe(9);
  });

  it('throws when API fails and no local fallback exists', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const service = new NoodlesCoinMetadataService('test-key', knownDecimals);
    await expect(service.getDecimals('0xunknown::foo::BAR', 'sui')).rejects.toThrow(
      'Cannot resolve decimals for coin type "0xunknown::foo::BAR"',
    );
  });

  it('returns full metadata from API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 200,
        data: { coin: { symbol: 'USDC', decimals: 6 } },
      }),
    });

    const coinType =
      '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
    const service = new NoodlesCoinMetadataService('test-key', knownDecimals);
    const meta = await service.getMetadata(coinType, 'sui');

    expect(meta).toEqual({
      coinType,
      symbol: 'USDC',
      decimals: 6,
    });
  });

  it('extracts symbol from coin type in fallback', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const service = new NoodlesCoinMetadataService('test-key', knownDecimals);
    const meta = await service.getMetadata('0x2::sui::SUI', 'sui');

    expect(meta.symbol).toBe('SUI');
    expect(meta.decimals).toBe(9);
  });

  it('sends correct headers to API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 200,
        data: { coin: { symbol: 'SUI', decimals: 9 } },
      }),
    });

    const service = new NoodlesCoinMetadataService(
      'my-api-key',
      knownDecimals,
      'https://custom.api',
    );
    await service.getDecimals('0x2::sui::SUI', 'sui');

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://custom.api/api/v1/partner/coin-detail');
    expect(url).toContain('coin_id=0x2%3A%3Asui%3A%3ASUI');
    expect((options.headers as Record<string, string>)['x-api-key']).toBe('my-api-key');
    expect((options.headers as Record<string, string>)['x-chain']).toBe('sui');
  });
});
