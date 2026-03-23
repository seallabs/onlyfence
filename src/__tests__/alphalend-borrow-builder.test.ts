import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinishContext } from '../core/action-builder.js';
import type { BorrowIntent } from '../core/action-types.js';
import type { ActivityLog } from '../db/activity-log.js';

// Mock AlphaLend SDK
const mockBorrow = vi.fn();
const mockGetUserPositionCapId = vi.fn();
const mockGetMarketsChain = vi.fn();
const mockGetUserPortfolioFromPositionCapId = vi.fn();

vi.mock('@alphafi/alphalend-sdk', () => ({
  AlphalendClient: class MockAlphalendClient {
    borrow = mockBorrow;
    getMarketsChain = mockGetMarketsChain;
    getUserPortfolioFromPositionCapId = mockGetUserPortfolioFromPositionCapId;
  },
  getUserPositionCapId: (...args: unknown[]) => mockGetUserPositionCapId(...args),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let AlphaLendBorrowBuilder: typeof import('../chain/sui/alphalend/borrow.js').AlphaLendBorrowBuilder;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../chain/sui/alphalend/borrow.js');
  AlphaLendBorrowBuilder = mod.AlphaLendBorrowBuilder;
});

function makeBorrowIntent(overrides?: Partial<BorrowIntent['params']>): BorrowIntent {
  return {
    action: 'lending:borrow',
    chainId: 'sui:mainnet',
    walletAddress: '0x' + 'a'.repeat(64),
    params: {
      coinType: '0x2::sui::SUI',
      amount: '500000000',
      protocol: 'alphalend',
      marketId: '1',
      ...overrides,
    },
  };
}

describe('AlphaLendBorrowBuilder', () => {
  let mockAlphalendClient: AlphalendClient;
  let mockSuiClient: SuiClient;
  let mockActivityLog: ActivityLog;

  beforeEach(() => {
    mockAlphalendClient = {
      borrow: mockBorrow,
      getMarketsChain: mockGetMarketsChain,
      getUserPortfolioFromPositionCapId: mockGetUserPortfolioFromPositionCapId,
    } as unknown as AlphalendClient;
    mockSuiClient = {} as unknown as SuiClient;
    mockActivityLog = {
      logActivity: vi.fn().mockReturnValue(1),
    } as unknown as ActivityLog;
  });

  describe('validate', () => {
    let builder: InstanceType<typeof AlphaLendBorrowBuilder>;

    beforeEach(() => {
      builder = new AlphaLendBorrowBuilder(mockAlphalendClient, mockSuiClient, mockActivityLog);
    });

    it('does not throw for valid intent', () => {
      expect(() => builder.validate(makeBorrowIntent())).not.toThrow();
    });

    it('throws when coinType is empty', () => {
      const intent = makeBorrowIntent({ coinType: '' });
      expect(() => builder.validate(intent)).toThrow(/coinType/i);
    });

    it('throws when amount is zero', () => {
      const intent = makeBorrowIntent({ amount: '0' });
      expect(() => builder.validate(intent)).toThrow(/amount/i);
    });
  });

  describe('build', () => {
    it('fetches positionCapId, calls borrow with priceUpdateCoinTypes', async () => {
      const fakeTx = { kind: 'transaction', setSenderIfNotSet: vi.fn() };
      const fakeCapId = '0xcap123';
      mockGetMarketsChain.mockResolvedValue([{ market: { id: 1, coinType: '0x2::sui::SUI' } }]);
      mockGetUserPositionCapId.mockResolvedValue(fakeCapId);
      mockGetUserPortfolioFromPositionCapId.mockResolvedValue({
        borrowedAmounts: new Map(),
        suppliedAmounts: new Map(),
      });
      mockBorrow.mockResolvedValue(fakeTx);

      const builder = new AlphaLendBorrowBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockActivityLog,
      );
      const intent = makeBorrowIntent();
      const result = await builder.build(intent);

      expect(mockGetUserPositionCapId).toHaveBeenCalledWith(
        mockSuiClient,
        expect.any(String),
        intent.walletAddress,
      );
      expect(mockBorrow).toHaveBeenCalledWith(
        expect.objectContaining({
          positionCapId: fakeCapId,
          marketId: '1',
          amount: BigInt('500000000'),
          coinType: '0x2::sui::SUI',
          address: intent.walletAddress,
          priceUpdateCoinTypes: ['0x2::sui::SUI'],
        }),
      );
      expect(result.transaction).toBeDefined();
      expect(result.metadata).toEqual(
        expect.objectContaining({
          action: 'borrow',
          protocol: 'alphalend',
        }),
      );
    });

    it('throws if no position exists (no positionCapId)', async () => {
      mockGetMarketsChain.mockResolvedValue([{ market: { id: 1, coinType: '0x2::sui::SUI' } }]);
      mockGetUserPositionCapId.mockResolvedValue(undefined);

      const builder = new AlphaLendBorrowBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockActivityLog,
      );
      await expect(builder.build(makeBorrowIntent())).rejects.toThrow(/position/i);
    });
  });

  describe('finish', () => {
    it('logs with action borrow', () => {
      const builder = new AlphaLendBorrowBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockActivityLog,
      );
      const intent = makeBorrowIntent();
      const context: FinishContext = {
        intent,
        status: 'approved',
        txDigest: '0xdigest',
        gasUsed: 0.002,
      };

      builder.finish!(context);

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'lending:borrow',
          protocol: 'alphalend',
          token_a_type: undefined,
          token_a_amount: undefined,
          policy_decision: 'approved',
          metadata: { market_id: '1' },
        }),
      );
    });
  });
});
