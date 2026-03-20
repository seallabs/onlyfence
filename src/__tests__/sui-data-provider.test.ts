import { describe, it, expect, vi } from 'vitest';
import { SuiDataProvider } from '../chain/sui/data-provider.js';
import type { LPProService, LPProCoinRecord, LPProTokenPrice } from '../data/lp-pro-service.js';

function createMockLPPro(overrides?: {
  fetchCoins?: (coinTypes: readonly string[]) => Promise<LPProCoinRecord[]>;
  fetchPrices?: (tokenIds: readonly string[], timestamp?: number) => Promise<LPProTokenPrice[]>;
}): LPProService {
  return {
    fetchCoins: vi.fn(overrides?.fetchCoins ?? (async () => [])),
    fetchPrices: vi.fn(overrides?.fetchPrices ?? (async () => [])),
  } as unknown as LPProService;
}

/** All addresses must be normalized (full-length) — same as production callers. */
const SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

const knownDecimals: Readonly<Record<string, number>> = {
  [SUI]: 9,
  [USDC]: 6,
};

describe('SuiDataProvider', () => {
  describe('getPrice', () => {
    it('returns price from API', async () => {
      const lpPro = createMockLPPro({
        fetchPrices: async () => [{ token_id: SUI, timestamp: 0, price: 3.5 }],
      });

      const provider = new SuiDataProvider(lpPro, knownDecimals);
      const price = await provider.getPrice(SUI);

      expect(price).toBe(3.5);
    });

    it('throws when no price found', async () => {
      const lpPro = createMockLPPro();

      const provider = new SuiDataProvider(lpPro, knownDecimals);
      await expect(provider.getPrice(SUI)).rejects.toThrow('No USD price found');
    });
  });

  describe('getPrices', () => {
    it('returns prices for multiple tokens', async () => {
      const lpPro = createMockLPPro({
        fetchPrices: async () => [
          { token_id: SUI, timestamp: 0, price: 3.5 },
          { token_id: USDC, timestamp: 0, price: 1.0 },
        ],
      });

      const provider = new SuiDataProvider(lpPro, knownDecimals);
      const prices = await provider.getPrices([SUI, USDC]);

      expect(prices).toEqual({ [SUI]: 3.5, [USDC]: 1.0 });
    });

    it('returns empty object for empty input', async () => {
      const lpPro = createMockLPPro();
      const provider = new SuiDataProvider(lpPro, knownDecimals);

      const prices = await provider.getPrices([]);
      expect(prices).toEqual({});
      expect(lpPro.fetchPrices).not.toHaveBeenCalled();
    });
  });

  describe('getMetadata', () => {
    it('returns metadata from API', async () => {
      const lpPro = createMockLPPro({
        fetchCoins: async () => [
          {
            coin_type: SUI,
            symbol: 'SUI',
            decimals: 9,
            name: 'Sui',
            verified: true,
            no_price: false,
          },
        ],
      });

      const provider = new SuiDataProvider(lpPro, knownDecimals);
      const meta = await provider.getMetadata(SUI);

      expect(meta).toEqual({ address: SUI, symbol: 'SUI', decimals: 9 });
    });

    it('falls back to known decimals when API fails', async () => {
      const lpPro = createMockLPPro({
        fetchCoins: async () => {
          throw new Error('Network error');
        },
      });

      const provider = new SuiDataProvider(lpPro, knownDecimals);
      const meta = await provider.getMetadata(SUI);

      expect(meta.decimals).toBe(9);
      expect(meta.symbol).toBe('SUI');
    });

    it('throws when API fails and no fallback exists', async () => {
      const lpPro = createMockLPPro({
        fetchCoins: async () => {
          throw new Error('Network error');
        },
      });

      const unknown =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef::foo::BAR';
      const provider = new SuiDataProvider(lpPro, {});
      await expect(provider.getMetadata(unknown)).rejects.toThrow('LP Pro API unreachable');
    });

    it('fills missing API results with known fallbacks', async () => {
      const otherToken =
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890::tok::TOK';
      const lpPro = createMockLPPro({
        fetchCoins: async () => [
          {
            coin_type: otherToken,
            symbol: 'TOK',
            decimals: 8,
            name: 'Token',
            verified: true,
            no_price: false,
          },
        ],
      });

      const provider = new SuiDataProvider(lpPro, knownDecimals);
      const result = await provider.getMetadatas([SUI, otherToken]);

      expect(result[SUI]).toEqual({
        address: SUI,
        symbol: 'SUI',
        decimals: 9,
      });
      expect(result[otherToken]).toEqual({
        address: otherToken,
        symbol: 'TOK',
        decimals: 8,
      });
    });
  });

  describe('getMetadatas', () => {
    it('returns empty object for empty input', async () => {
      const lpPro = createMockLPPro();
      const provider = new SuiDataProvider(lpPro, knownDecimals);

      const result = await provider.getMetadatas([]);
      expect(result).toEqual({});
      expect(lpPro.fetchCoins).not.toHaveBeenCalled();
    });

    it('returns metadata for multiple tokens', async () => {
      const lpPro = createMockLPPro({
        fetchCoins: async () => [
          {
            coin_type: SUI,
            symbol: 'SUI',
            decimals: 9,
            name: 'Sui',
            verified: true,
            no_price: false,
          },
          {
            coin_type: USDC,
            symbol: 'USDC',
            decimals: 6,
            name: 'USD Coin',
            verified: true,
            no_price: false,
          },
        ],
      });

      const provider = new SuiDataProvider(lpPro, knownDecimals);
      const result = await provider.getMetadatas([SUI, USDC]);

      expect(result[SUI]).toEqual({
        address: SUI,
        symbol: 'SUI',
        decimals: 9,
      });
      expect(result[USDC]).toEqual({ address: USDC, symbol: 'USDC', decimals: 6 });
    });
  });
});
