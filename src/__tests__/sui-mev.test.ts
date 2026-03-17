import { describe, it, expect } from 'vitest';
import { SuiNoOpMev } from '../chain/sui/sui-mev.js';
import type { MevProtector } from '../core/mev-protector.js';

describe('SuiNoOpMev', () => {
  it('has name "sui-noop"', () => {
    expect(new SuiNoOpMev().name).toBe('sui-noop');
  });

  it('returns the input bytes unchanged (same reference)', async () => {
    const mev = new SuiNoOpMev();
    const bytes = new Uint8Array([10, 20, 30, 40]);
    const result = await mev.protect(bytes, 'sui');
    expect(result.bytes).toBe(bytes);
  });

  it('returns empty metadata', async () => {
    const mev = new SuiNoOpMev();
    const result = await mev.protect(new Uint8Array([0]), 'sui');
    expect(result.metadata).toEqual({});
  });

  it('satisfies MevProtector interface', () => {
    const protector: MevProtector = new SuiNoOpMev();
    expect(protector).toBeDefined();
  });
});
