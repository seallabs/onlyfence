import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SwapIntent } from '../core/action-types.js';

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
let SuiSwapBuilder: typeof import('../chain/sui/7k/swap.js').SuiSwapBuilder;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../chain/sui/7k/swap.js');
  SuiSwapBuilder = mod.SuiSwapBuilder;
});

function makeSwapIntent(overrides?: Partial<SwapIntent['params']>): SwapIntent {
  return {
    action: 'trade:swap',
    chainId: 'sui:mainnet',
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
    const mockActivityLog = {
      logActivity: vi.fn(),
    } as unknown as import('../db/activity-log.js').ActivityLog;
    const builder = new SuiSwapBuilder(mockActivityLog);
    expect(builder.builderId).toBe('7k-swap');
    expect(builder.chain).toBe('sui');
  });

  describe('validate', () => {
    let builder: InstanceType<typeof SuiSwapBuilder>;

    beforeEach(() => {
      const mockActivityLog = {
        logActivity: vi.fn(),
      } as unknown as import('../db/activity-log.js').ActivityLog;
      builder = new SuiSwapBuilder(mockActivityLog);
    });

    it('throws when coinTypeIn equals coinTypeOut', () => {
      const intent = makeSwapIntent({ coinTypeOut: '0x2::sui::SUI' });
      expect(() => builder.validate(intent)).toThrow('Cannot swap token to itself');
    });

    it('throws when amountIn is zero', () => {
      const intent = makeSwapIntent({ amountIn: '0' });
      expect(() => builder.validate(intent)).toThrow('Invalid amount');
    });

    it('throws when amountIn is negative', () => {
      const intent = makeSwapIntent({ amountIn: '-1' });
      expect(() => builder.validate(intent)).toThrow('Invalid amount');
    });

    it('throws when coinTypeIn is empty', () => {
      const intent = makeSwapIntent({ coinTypeIn: '' });
      expect(() => builder.validate(intent)).toThrow('Missing token types');
    });

    it('throws when coinTypeOut is empty', () => {
      const intent = makeSwapIntent({ coinTypeOut: '' });
      expect(() => builder.validate(intent)).toThrow('Missing token types');
    });

    it('does not throw for valid intent', () => {
      expect(() => builder.validate(makeSwapIntent())).not.toThrow();
    });
  });

  describe('build', () => {
    it('fetches quotes, selects best, and returns BuiltTransaction with metadata', async () => {
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
      mockSwap.mockResolvedValue('coin-out-arg');

      const mockActivityLog = {
        logActivity: vi.fn(),
      } as unknown as import('../db/activity-log.js').ActivityLog;
      const builder = new SuiSwapBuilder(mockActivityLog);
      const result = await builder.build(makeSwapIntent());

      expect(result.transaction).toBeDefined();
      expect(result.metadata).toEqual(
        expect.objectContaining({
          action: 'swap',
          expectedOutput: '2490000',
          provider: 'cetus',
          amountIn: '1000000000',
          description: 'Swap via cetus',
        }),
      );
      expect(mockTransferObjects).toHaveBeenCalled();
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
      mockSwap.mockResolvedValue('coin-out-arg');

      const mockActivityLog = {
        logActivity: vi.fn(),
      } as unknown as import('../db/activity-log.js').ActivityLog;
      const builder = new SuiSwapBuilder(mockActivityLog);
      const result = await builder.build(makeSwapIntent());

      // quote2 has higher amountOut (2600000 > 2490000/2500000)
      expect(result.metadata['provider']).toBe('bluefin7k');
      expect(result.metadata['expectedOutput']).toBe('2600000');
    });

    it('throws when no quotes available', async () => {
      mockQuote.mockResolvedValue([]);

      const mockActivityLog = {
        logActivity: vi.fn(),
      } as unknown as import('../db/activity-log.js').ActivityLog;
      const builder = new SuiSwapBuilder(mockActivityLog);
      await expect(builder.build(makeSwapIntent())).rejects.toThrow('No swap quotes available');
    });

    it('throws on network error from quote', async () => {
      mockQuote.mockRejectedValue(new Error('Network timeout'));

      const mockActivityLog = {
        logActivity: vi.fn(),
      } as unknown as import('../db/activity-log.js').ActivityLog;
      const builder = new SuiSwapBuilder(mockActivityLog);
      await expect(builder.build(makeSwapIntent())).rejects.toThrow('Failed to fetch swap quote');
    });
  });
});
