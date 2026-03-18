import { describe, it, expect } from 'vitest';
import { NoOpMevProtector } from '../core/mev-protector.js';
import type { MevProtector } from '../core/mev-protector.js';

describe('NoOpMevProtector', () => {
  it('has name "noop"', () => {
    expect(new NoOpMevProtector().name).toBe('noop');
  });

  it('returns the input bytes unchanged (same reference)', async () => {
    const protector = new NoOpMevProtector();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = await protector.protect(bytes, 'sui:mainnet');
    expect(result.bytes).toBe(bytes);
  });

  it('returns empty metadata', async () => {
    const protector = new NoOpMevProtector();
    const result = await protector.protect(new Uint8Array([0]), 'sui:mainnet');
    expect(result.metadata).toEqual({});
  });

  it('satisfies MevProtector interface', () => {
    const protector: MevProtector = new NoOpMevProtector();
    expect(protector).toBeDefined();
  });
});
