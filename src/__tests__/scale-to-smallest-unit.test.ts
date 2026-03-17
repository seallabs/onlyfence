import { describe, it, expect } from 'vitest';
import { scaleToSmallestUnit } from '../chain/sui/tokens.js';

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
