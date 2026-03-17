import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SwapIntent } from '../core/action-types.js';
import type { ActionPreview } from '../core/action-builder.js';

// Mock MetaAg
const mockQuote = vi.fn();
const mockSwap = vi.fn();

vi.mock('@7kprotocol/sdk-ts', () => ({
  MetaAg: class MockMetaAg {
    quote = mockQuote;
    swap = mockSwap;
  },
  EProvider: {
    BLUEFIN7K: 'bluefin7k',
    CETUS: 'cetus',
    FLOWX: 'flowx',
  },
}));

// Mock @mysten/sui/transactions
const mockTransferObjects = vi.fn();
const mockPureAddress = vi.fn().mockReturnValue('address-arg');

vi.mock('@mysten/sui/transactions', () => ({
  Transaction: class MockTransaction {
    transferObjects = mockTransferObjects;
    pure = { address: mockPureAddress };
  },
  coinWithBalance: vi.fn().mockReturnValue(() => 'coin-in-arg'),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let SuiSwapBuilder: typeof import('../chain/sui/builder/swap-builder.js').SuiSwapBuilder;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../chain/sui/builder/swap-builder.js');
  SuiSwapBuilder = mod.SuiSwapBuilder;
});

function makeSwapIntent(overrides?: Partial<SwapIntent['params']>): SwapIntent {
  return {
    action: 'swap',
    chain: 'sui',
    walletAddress: '0x' + 'a'.repeat(64),
    params: {
      coinTypeIn: '0x2::sui::SUI',
      coinTypeOut: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      amountIn: '1000000000',
      slippageBps: 100,
      ...overrides,
    },
  };
}

describe('SuiSwapBuilder', () => {
  it('has correct builderId and chain', () => {
    const builder = new SuiSwapBuilder();
    expect(builder.builderId).toBe('7k-swap');
    expect(builder.chain).toBe('sui');
  });

  describe('validate', () => {
    it('throws when coinTypeIn equals coinTypeOut', () => {
      const builder = new SuiSwapBuilder();
      const intent = makeSwapIntent({ coinTypeOut: '0x2::sui::SUI' });
      expect(() => builder.validate(intent)).toThrow('Cannot swap token to itself');
    });

    it('throws when amountIn is zero', () => {
      const builder = new SuiSwapBuilder();
      const intent = makeSwapIntent({ amountIn: '0' });
      expect(() => builder.validate(intent)).toThrow('Invalid amount');
    });

    it('throws when amountIn is negative', () => {
      const builder = new SuiSwapBuilder();
      const intent = makeSwapIntent({ amountIn: '-1' });
      expect(() => builder.validate(intent)).toThrow('Invalid amount');
    });

    it('throws when coinTypeIn is empty', () => {
      const builder = new SuiSwapBuilder();
      const intent = makeSwapIntent({ coinTypeIn: '' });
      expect(() => builder.validate(intent)).toThrow('Missing token types');
    });

    it('throws when coinTypeOut is empty', () => {
      const builder = new SuiSwapBuilder();
      const intent = makeSwapIntent({ coinTypeOut: '' });
      expect(() => builder.validate(intent)).toThrow('Missing token types');
    });

    it('does not throw for valid intent', () => {
      const builder = new SuiSwapBuilder();
      expect(() => builder.validate(makeSwapIntent())).not.toThrow();
    });
  });

  describe('preview', () => {
    it('returns ActionPreview with expectedOutput and provider', async () => {
      const fakeQuote = {
        provider: 'cetus',
        amountIn: '1000000000',
        amountOut: '2500000',
        simulatedAmountOut: '2490000',
        coinTypeIn: '0x2::sui::SUI',
        coinTypeOut: '0xdba3::usdc::USDC',
        id: 'q1',
      };
      mockQuote.mockResolvedValue([fakeQuote]);

      const builder = new SuiSwapBuilder();
      const intent = makeSwapIntent();
      const preview = await builder.preview(intent);

      expect(preview.expectedOutput).toBe('2490000');
      expect(preview.provider).toBe('cetus');
      expect(preview.description).toContain('cetus');
      expect(preview.buildData).toBeDefined();
    });

    it('selects the best quote by amountOut', async () => {
      const quote1 = {
        provider: 'cetus',
        amountIn: '1000000000',
        amountOut: '2500000',
        simulatedAmountOut: '2490000',
        coinTypeIn: '0x2::sui::SUI',
        coinTypeOut: '0xdba3::usdc::USDC',
        id: 'q1',
      };
      const quote2 = {
        provider: 'bluefin7k',
        amountIn: '1000000000',
        amountOut: '2600000',
        coinTypeIn: '0x2::sui::SUI',
        coinTypeOut: '0xdba3::usdc::USDC',
        id: 'q2',
      };
      mockQuote.mockResolvedValue([quote1, quote2]);

      const builder = new SuiSwapBuilder();
      const preview = await builder.preview(makeSwapIntent());

      // quote2 has higher amountOut (2600000 > 2490000/2500000)
      expect(preview.provider).toBe('bluefin7k');
      expect(preview.expectedOutput).toBe('2600000');
    });

    it('throws when no quotes available', async () => {
      mockQuote.mockResolvedValue([]);

      const builder = new SuiSwapBuilder();
      await expect(builder.preview(makeSwapIntent())).rejects.toThrow('No swap quotes available');
    });

    it('throws on network error from quote', async () => {
      mockQuote.mockRejectedValue(new Error('Network timeout'));

      const builder = new SuiSwapBuilder();
      await expect(builder.preview(makeSwapIntent())).rejects.toThrow('Failed to fetch swap quote');
    });
  });

  describe('build', () => {
    it('returns BuiltTransaction with transaction and metadata', async () => {
      const fakeQuote = {
        provider: 'cetus',
        amountIn: '1000000000',
        amountOut: '2500000',
        coinTypeIn: '0x2::sui::SUI',
        coinTypeOut: '0xdba3::usdc::USDC',
        id: 'q1',
      };

      const preview: ActionPreview = {
        description: 'Swap via cetus',
        expectedOutput: '2500000',
        provider: 'cetus',
        buildData: fakeQuote,
      };

      mockSwap.mockResolvedValue('coin-out-arg');

      const builder = new SuiSwapBuilder();
      const result = await builder.build(makeSwapIntent(), preview);

      expect(result.transaction).toBeDefined();
      expect(result.metadata).toEqual(
        expect.objectContaining({
          action: 'swap',
          provider: 'cetus',
          amountIn: '1000000000',
          amountOut: '2500000',
        }),
      );
      expect(mockTransferObjects).toHaveBeenCalled();
    });
  });
});
