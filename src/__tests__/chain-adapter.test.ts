import { describe, it, expect, beforeEach } from 'vitest';
import { ChainAdapterFactory } from '../chain/factory.js';
import { SuiAdapter } from '../chain/sui/adapter.js';
import { SUI_TOKEN_MAP, resolveTokenAddress, isKnownToken } from '../chain/sui/tokens.js';
import type { ChainAdapter } from '../chain/adapter.js';
import type { BalanceResult, SimulationResult, TxResult, Signer } from '../types/result.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal stub adapter for factory tests (not Sui-specific). */
class StubAdapter implements ChainAdapter {
  readonly chain: string;

  constructor(chain: string) {
    this.chain = chain;
  }

  async getBalance(_address: string): Promise<BalanceResult> {
    return { address: '', balances: [] };
  }

  async buildTransactionBytes(_transaction: unknown): Promise<Uint8Array> {
    return new Uint8Array();
  }

  async simulate(_txBytes: Uint8Array, _sender: string): Promise<SimulationResult> {
    return { success: true, gasEstimate: 0 };
  }

  async signAndSubmit(_txBytes: Uint8Array, _signer: Signer): Promise<TxResult> {
    return { txDigest: '', status: 'success', gasUsed: 0 };
  }
}

// ---------------------------------------------------------------------------
// ChainAdapterFactory
// ---------------------------------------------------------------------------

describe('ChainAdapterFactory', () => {
  let factory: ChainAdapterFactory;

  beforeEach(() => {
    factory = new ChainAdapterFactory();
  });

  it('should register an adapter and retrieve it by chain', () => {
    const adapter = new StubAdapter('sui');
    factory.register(adapter);

    expect(factory.get('sui')).toBe(adapter);
  });

  it('should report registered chains via has()', () => {
    factory.register(new StubAdapter('sui'));

    expect(factory.has('sui')).toBe(true);
    expect(factory.has('evm')).toBe(false);
  });

  it('should list all registered chain identifiers', () => {
    factory.register(new StubAdapter('sui'));
    factory.register(new StubAdapter('evm'));

    expect(factory.list()).toEqual(['sui', 'evm']);
  });

  it('should throw when getting an unregistered chain', () => {
    expect(() => factory.get('solana')).toThrow('no adapter registered for chain "solana"');
  });

  it('should throw when registering duplicate chain', () => {
    factory.register(new StubAdapter('sui'));

    expect(() => factory.register(new StubAdapter('sui'))).toThrow('already registered');
  });

  it('should return empty list when no adapters registered', () => {
    expect(factory.list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SuiAdapter placeholder
// ---------------------------------------------------------------------------

describe('SuiAdapter', () => {
  let adapter: SuiAdapter;

  beforeEach(() => {
    adapter = new SuiAdapter();
  });

  it('should have chain set to "sui"', () => {
    expect(adapter.chain).toBe('sui');
  });

  it('getBalance should throw not implemented', async () => {
    await expect(adapter.getBalance('0xabc')).rejects.toThrow(
      'SuiAdapter.getBalance not implemented',
    );
  });

  it('buildTransactionBytes should throw not implemented', async () => {
    await expect(adapter.buildTransactionBytes({})).rejects.toThrow(
      'SuiAdapter.buildTransactionBytes not implemented',
    );
  });

  it('simulate should throw not implemented', async () => {
    await expect(adapter.simulate(new Uint8Array(), '0xabc')).rejects.toThrow(
      'SuiAdapter.simulate not implemented',
    );
  });

  it('signAndSubmit should throw not implemented', async () => {
    const signer: Signer = {
      address: '0xabc',
      publicKey: new Uint8Array(32),
      sign: async (_data: Uint8Array) => new Uint8Array(),
    };
    await expect(adapter.signAndSubmit(new Uint8Array(), signer)).rejects.toThrow(
      'SuiAdapter.signAndSubmit not implemented',
    );
  });

  it('should be registerable with ChainAdapterFactory', () => {
    const factory = new ChainAdapterFactory();
    factory.register(adapter);

    expect(factory.get('sui')).toBe(adapter);
  });
});

// ---------------------------------------------------------------------------
// Token Registry
// ---------------------------------------------------------------------------

describe('SUI Token Registry', () => {
  it('should resolve known token symbols', () => {
    expect(resolveTokenAddress('SUI')).toBe('0x2::sui::SUI');
    expect(resolveTokenAddress('USDC')).toContain('::usdc::USDC');
    expect(resolveTokenAddress('USDT')).toContain('::coin::COIN');
    expect(resolveTokenAddress('DEEP')).toContain('::deep::DEEP');
    expect(resolveTokenAddress('WAL')).toContain('::wal::WAL');
  });

  it('should throw on unknown token symbol', () => {
    expect(() => resolveTokenAddress('SCAMCOIN')).toThrow('Unknown Sui token symbol "SCAMCOIN"');
  });

  it('should include known tokens list in error message', () => {
    expect(() => resolveTokenAddress('FAKE')).toThrow('Known tokens:');
  });

  it('isKnownToken should return true for registered tokens', () => {
    expect(isKnownToken('SUI')).toBe(true);
    expect(isKnownToken('USDC')).toBe(true);
    expect(isKnownToken('DEEP')).toBe(true);
  });

  it('isKnownToken should return false for unknown tokens', () => {
    expect(isKnownToken('UNKNOWN')).toBe(false);
    expect(isKnownToken('')).toBe(false);
  });

  it('SUI_TOKEN_MAP should contain all expected tokens', () => {
    const expectedTokens = ['SUI', 'USDC', 'USDT', 'DEEP', 'BLUE', 'WAL'];
    for (const token of expectedTokens) {
      expect(SUI_TOKEN_MAP[token]).toBeDefined();
    }
  });
});
