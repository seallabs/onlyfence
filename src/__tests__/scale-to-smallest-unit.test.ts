import { describe, it, expect } from 'vitest';
import { scaleToSmallestUnit } from '../chain/sui/tokens.js';

describe('scaleToSmallestUnit', () => {
  it('scales SUI (9 decimals)', () => {
    expect(scaleToSmallestUnit('100', '0x2::sui::SUI')).toBe('100000000000');
  });

  it('scales USDC (6 decimals)', () => {
    const usdcType =
      '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
    expect(scaleToSmallestUnit('50.5', usdcType)).toBe('50500000');
  });

  it('handles fractional amounts', () => {
    expect(scaleToSmallestUnit('0.001', '0x2::sui::SUI')).toBe('1000000');
  });

  it('floors excess decimal places', () => {
    const usdcType =
      '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
    expect(scaleToSmallestUnit('1.1234567', usdcType)).toBe('1123456'); // 6 decimals, truncate
  });

  it('throws on unknown coin type', () => {
    expect(() => scaleToSmallestUnit('100', '0xunknown::foo::BAR')).toThrow('Unknown decimals');
  });

  it('throws on invalid amount', () => {
    expect(() => scaleToSmallestUnit('-5', '0x2::sui::SUI')).toThrow('must be a positive number');
  });

  it('throws on non-numeric amount', () => {
    expect(() => scaleToSmallestUnit('abc', '0x2::sui::SUI')).toThrow('must be a positive number');
  });

  it('throws on zero amount', () => {
    expect(() => scaleToSmallestUnit('0', '0x2::sui::SUI')).toThrow('must be a positive number');
  });
});
