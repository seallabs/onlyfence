import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BorrowIntent } from '../core/action-types.js';
import type { FinishContext } from '../core/action-builder.js';
import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import type { LendingLog } from '../db/lending-log.js';

// Mock AlphaLend SDK
const mockBorrow = vi.fn();
const mockGetUserPositionCapId = vi.fn();

vi.mock('@alphafi/alphalend-sdk', () => ({
  AlphalendClient: class MockAlphalendClient {
    borrow = mockBorrow;
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
    action: 'borrow',
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
  let mockLendingLog: LendingLog;

  beforeEach(() => {
    mockAlphalendClient = { borrow: mockBorrow } as unknown as AlphalendClient;
    mockSuiClient = {} as unknown as SuiClient;
    mockLendingLog = {
      logActivity: vi.fn().mockReturnValue(1),
    } as unknown as LendingLog;
  });

  describe('validate', () => {
    let builder: InstanceType<typeof AlphaLendBorrowBuilder>;

    beforeEach(() => {
      builder = new AlphaLendBorrowBuilder(mockAlphalendClient, mockSuiClient, mockLendingLog);
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
      mockGetUserPositionCapId.mockResolvedValue(fakeCapId);
      mockBorrow.mockResolvedValue(fakeTx);

      const builder = new AlphaLendBorrowBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockLendingLog,
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
      mockGetUserPositionCapId.mockResolvedValue(undefined);

      const builder = new AlphaLendBorrowBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockLendingLog,
      );
      await expect(builder.build(makeBorrowIntent())).rejects.toThrow(/position/i);
    });
  });

  describe('finish', () => {
    it('logs with action borrow', () => {
      const builder = new AlphaLendBorrowBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockLendingLog,
      );
      const intent = makeBorrowIntent();
      const context: FinishContext = {
        intent,
        status: 'approved',
        txDigest: '0xdigest',
        gasUsed: 0.002,
      };

      builder.finish!(context);

      expect(mockLendingLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'borrow',
          protocol: 'alphalend',
          market_id: '1',
          coin_type: '0x2::sui::SUI',
          amount: '500000000',
          policy_decision: 'approved',
        }),
      );
    });
  });
});
