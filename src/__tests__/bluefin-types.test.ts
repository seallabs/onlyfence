import { describe, expect, it } from 'vitest';
import {
  BLUEFIN_SYNTHETIC_PREFIX,
  BLUEFIN_DECIMALS,
  toBluefinCoinType,
  isBluefinSynthetic,
  fromE9,
  toE9,
  nativeToE9,
  parseBluefinMarketSymbol,
} from '../chain/sui/bluefin-pro/types.js';

describe('Bluefin Pro types', () => {
  describe('constants', () => {
    it('has 64-char hex prefix with 0x', () => {
      expect(BLUEFIN_SYNTHETIC_PREFIX).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('uses 9 decimals for all synthetic coins', () => {
      expect(BLUEFIN_DECIMALS).toBe(9);
    });
  });

  describe('synthetic coin types', () => {
    it('generates deterministic coin type from base asset', () => {
      const coinType = toBluefinCoinType('BTC');
      expect(coinType).toBe(`${BLUEFIN_SYNTHETIC_PREFIX}::bluefin_pro::BTC`);
    });

    it('detects synthetic coin types', () => {
      expect(isBluefinSynthetic(toBluefinCoinType('ETH'))).toBe(true);
      expect(isBluefinSynthetic('0x2::sui::SUI')).toBe(false);
    });

    it('generates unique coin types per asset', () => {
      expect(toBluefinCoinType('BTC')).not.toBe(toBluefinCoinType('ETH'));
    });

    it('returns false for empty string', () => {
      expect(isBluefinSynthetic('')).toBe(false);
    });

    it('returns false for partial prefix match', () => {
      expect(isBluefinSynthetic('0xbf1bef')).toBe(false);
    });
  });

  describe('e9 conversion', () => {
    it('converts human-readable to e9 string', () => {
      expect(toE9('1.5')).toBe('1500000000');
      expect(toE9('100')).toBe('100000000000');
    });

    it('converts e9 string to human-readable number', () => {
      expect(fromE9('1500000000')).toBe(1.5);
      expect(fromE9('100000000000')).toBe(100);
    });

    it('handles zero', () => {
      expect(toE9('0')).toBe('0');
      expect(fromE9('0')).toBe(0);
    });

    it('handles small fractions without floating point error', () => {
      expect(toE9('0.000000001')).toBe('1');
    });

    it('converts native-scaled USDC (6 decimals) to e9', () => {
      // 0.1 USDC → native = 100000 (1e5) → e9 = 100000000 (1e8)
      expect(nativeToE9('100000', 6)).toBe('100000000');
    });

    it('converts native-scaled SUI (9 decimals) to e9 (no-op)', () => {
      // 1 SUI → native = 1000000000 (1e9) → e9 = 1000000000 (same)
      expect(nativeToE9('1000000000', 9)).toBe('1000000000');
    });

    it('converts native-scaled with 8 decimals to e9', () => {
      // native = 10000000 (1e7, 8 decimals) → e9 = 100000000 (1e8)
      expect(nativeToE9('10000000', 8)).toBe('100000000');
    });

    it('handles large values', () => {
      expect(toE9('1000000')).toBe('1000000000000000');
      expect(fromE9('1000000000000000')).toBe(1000000);
    });

    it('round-trips correctly', () => {
      const original = '123.456789';
      const e9 = toE9(original);
      const back = fromE9(e9);
      expect(back).toBe(123.456789);
    });
  });

  describe('parseBluefinMarketSymbol', () => {
    it('extracts base asset from market symbol', () => {
      expect(parseBluefinMarketSymbol('BTC-PERP')).toBe('BTC');
      expect(parseBluefinMarketSymbol('ETH-PERP')).toBe('ETH');
      expect(parseBluefinMarketSymbol('SUI-PERP')).toBe('SUI');
    });

    it('throws on invalid market symbol without PERP suffix', () => {
      expect(() => parseBluefinMarketSymbol('BTC-SPOT')).toThrow(/expected format/i);
    });

    it('throws on symbol without separator', () => {
      expect(() => parseBluefinMarketSymbol('INVALID')).toThrow();
    });

    it('throws on empty string', () => {
      expect(() => parseBluefinMarketSymbol('')).toThrow();
    });

    it('throws on symbol with too many parts', () => {
      expect(() => parseBluefinMarketSymbol('BTC-PERP-EXTRA')).toThrow();
    });

    it('throws on empty base asset', () => {
      expect(() => parseBluefinMarketSymbol('-PERP')).toThrow(/empty base/i);
    });
  });
});
