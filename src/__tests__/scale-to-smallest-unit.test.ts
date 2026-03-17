import { describe, it, expect } from 'vitest';
import { scaleToSmallestUnit, formatSmallestUnit } from '../chain/sui/tokens.js';

describe('scaleToSmallestUnit', () => {
  it('scales with 9 decimals (e.g. SUI)', () => {
    expect(scaleToSmallestUnit('100', 9)).toBe('100000000000');
  });

  it('scales with 6 decimals (e.g. USDC)', () => {
    expect(scaleToSmallestUnit('50.5', 6)).toBe('50500000');
  });

  it('handles fractional amounts', () => {
    expect(scaleToSmallestUnit('0.001', 9)).toBe('1000000');
  });

  it('floors excess decimal places', () => {
    expect(scaleToSmallestUnit('1.1234567', 6)).toBe('1123456');
  });

  it('throws on invalid amount', () => {
    expect(() => scaleToSmallestUnit('-5', 9)).toThrow('must be a positive number');
  });

  it('throws on non-numeric amount', () => {
    expect(() => scaleToSmallestUnit('abc', 9)).toThrow('must be a positive number');
  });

  it('throws on zero amount', () => {
    expect(() => scaleToSmallestUnit('0', 9)).toThrow('must be a positive number');
  });

  it('handles zero decimals', () => {
    expect(scaleToSmallestUnit('42.9', 0)).toBe('42');
  });

  it('handles large amounts', () => {
    expect(scaleToSmallestUnit('1000000', 6)).toBe('1000000000000');
  });
});

describe('formatSmallestUnit', () => {
  const SUI = '0x2::sui::SUI';
  const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

  it('formats SUI (9 decimals) whole number', () => {
    expect(formatSmallestUnit('100000000000', SUI)).toBe('100');
  });

  it('formats SUI with fractional part', () => {
    expect(formatSmallestUnit('100500000000', SUI)).toBe('100.5');
  });

  it('formats USDC (6 decimals)', () => {
    expect(formatSmallestUnit('50500000', USDC)).toBe('50.5');
  });

  it('strips trailing zeros in fraction', () => {
    expect(formatSmallestUnit('1000000000', SUI)).toBe('1');
  });

  it('handles sub-one amounts', () => {
    expect(formatSmallestUnit('1000000', SUI)).toBe('0.001');
  });

  it('returns raw string for unknown coin type', () => {
    expect(formatSmallestUnit('12345', '0xunknown::foo::BAR')).toBe('12345');
  });
});
