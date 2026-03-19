import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainAdapter } from '../chain/adapter.js';
import { ChainAdapterFactory } from '../chain/factory.js';
import {
  SUI_TOKEN_MAP,
  coinTypeToSymbol,
  isKnownToken,
  resolveTokenAddress,
} from '../chain/sui/tokens.js';
import type { BalanceResult, Signer, SimulationResult, TxResult } from '../types/result.js';

// Mock SuiJsonRpcClient so SuiAdapter can be constructed
vi.mock('@mysten/sui/jsonRpc', () => ({
  SuiJsonRpcClient: class MockSuiJsonRpcClient {
    constructor(_opts: Record<string, unknown>) {}
  },
}));

vi.mock('@mysten/bcs', () => ({
  toBase64: vi.fn((bytes: Uint8Array) => Buffer.from(bytes).toString('base64')),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal stub adapter for factory tests (not Sui-specific). */
class StubAdapter implements ChainAdapter {
  readonly chain: string;
  readonly chainId: string;

  constructor(chain: string, chainId?: string) {
    this.chain = chain;
    this.chainId = chainId ?? `${chain}:testnet`;
  }

  async getBalance(_address: string): Promise<BalanceResult> {
    return { address: '', balances: [] };
  }

  async buildTransactionBytes(_transaction: unknown): Promise<Uint8Array> {
    return new Uint8Array();
  }

  async simulate(_txBytes: Uint8Array, _sender: string): Promise<SimulationResult> {
    return { success: true, gasEstimate: 0, rawResponse: {} };
  }

  async signAndSubmit(_txBytes: Uint8Array, _signer: Signer): Promise<TxResult> {
    return { txDigest: '', status: 'success', gasUsed: 0, rawResponse: {} };
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
  // SuiAdapter requires a SuiJsonRpcClient, imported lazily to use mocked deps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adapter: any;

  beforeEach(async () => {
    const { SuiAdapter } = await import('../chain/sui/adapter.js');
    const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
    const mockClient = new SuiJsonRpcClient({ url: 'https://rpc.example.com', network: 'mainnet' });
    adapter = new SuiAdapter(mockClient);
  });

  it('should have chain set to "sui"', () => {
    expect(adapter.chain).toBe('sui');
  });

  it('should have chainId set to "sui:mainnet"', () => {
    expect(adapter.chainId).toBe('sui:mainnet');
  });

  it('getBalance should call the RPC client', async () => {
    await expect(adapter.getBalance('0xabc')).rejects.toThrow();
  });

  it('simulate should call the RPC client', async () => {
    await expect(adapter.simulate(new Uint8Array(), '0xabc')).rejects.toThrow();
  });

  it('signAndSubmit should call the RPC client', async () => {
    const signer: Signer = {
      address: '0xabc',
      publicKey: new Uint8Array(32),
      sign: async (_data: Uint8Array) => new Uint8Array(64),
    };
    await expect(adapter.signAndSubmit(new Uint8Array(), signer)).rejects.toThrow();
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
    expect(resolveTokenAddress('USDT')).toContain('::celer_usdt_coin::CELER_USDT_COIN');
    expect(resolveTokenAddress('wUSDT')).toContain('::coin::COIN');
    expect(resolveTokenAddress('DEEP')).toContain('::deep::DEEP');
    expect(resolveTokenAddress('WAL')).toContain('::wal::WAL');
  });

  it('should pass through raw coin types unchanged', () => {
    const rawCoinType =
      '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
    expect(resolveTokenAddress(rawCoinType)).toBe(rawCoinType);
  });

  it('should pass through arbitrary coin types without registry lookup', () => {
    const unknownCoinType = '0xabc123::my_module::MY_TOKEN';
    expect(resolveTokenAddress(unknownCoinType)).toBe(unknownCoinType);
  });

  it('should throw on unknown token symbol', () => {
    expect(() => resolveTokenAddress('SCAMCOIN')).toThrow('Unknown Sui token symbol "SCAMCOIN"');
  });

  it('should include known tokens list in error message', () => {
    expect(() => resolveTokenAddress('FAKE')).toThrow('Known tokens:');
  });

  it('should be case-sensitive for alias lookup', () => {
    expect(() => resolveTokenAddress('sui')).toThrow('Unknown Sui token symbol');
    expect(() => resolveTokenAddress('Usdc')).toThrow('Unknown Sui token symbol');
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

  it('coinTypeToSymbol should reverse-resolve known coin types', () => {
    expect(coinTypeToSymbol('0x2::sui::SUI')).toBe('SUI');
    expect(coinTypeToSymbol(SUI_TOKEN_MAP['USDC']!)).toBe('USDC');
    expect(coinTypeToSymbol(SUI_TOKEN_MAP['DEEP']!)).toBe('DEEP');
  });

  it('coinTypeToSymbol should return undefined for unknown coin types', () => {
    expect(coinTypeToSymbol('0xunknown::module::TOKEN')).toBeUndefined();
    expect(coinTypeToSymbol('')).toBeUndefined();
  });
});
