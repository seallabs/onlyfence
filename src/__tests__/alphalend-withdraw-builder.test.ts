import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WithdrawIntent } from '../core/action-types.js';
import type { FinishContext } from '../core/action-builder.js';
import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import type { LendingLog } from '../db/lending-log.js';

// Mock AlphaLend SDK
const mockWithdraw = vi.fn();
const mockGetUserPositionCapId = vi.fn();
const mockGetMarketsChain = vi.fn();
const mockGetUserPortfolioFromPositionCapId = vi.fn();

vi.mock('@alphafi/alphalend-sdk', () => ({
  AlphalendClient: class MockAlphalendClient {
    withdraw = mockWithdraw;
    getMarketsChain = mockGetMarketsChain;
    getUserPortfolioFromPositionCapId = mockGetUserPortfolioFromPositionCapId;
  },
  getUserPositionCapId: (...args: unknown[]) => mockGetUserPositionCapId(...args),
  MAX_U64: BigInt('18446744073709551615'),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let AlphaLendWithdrawBuilder: typeof import('../chain/sui/alphalend/withdraw.js').AlphaLendWithdrawBuilder;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../chain/sui/alphalend/withdraw.js');
  AlphaLendWithdrawBuilder = mod.AlphaLendWithdrawBuilder;
});

function makeWithdrawIntent(overrides?: Partial<WithdrawIntent['params']>): WithdrawIntent {
  return {
    action: 'withdraw',
    chainId: 'sui:mainnet',
    walletAddress: '0x' + 'a'.repeat(64),
    params: {
      coinType: '0x2::sui::SUI',
      amount: '1000000000',
      protocol: 'alphalend',
      marketId: '1',
      ...overrides,
    },
  };
}

describe('AlphaLendWithdrawBuilder', () => {
  let mockAlphalendClient: AlphalendClient;
  let mockSuiClient: SuiClient;
  let mockLendingLog: LendingLog;

  beforeEach(() => {
    mockAlphalendClient = {
      withdraw: mockWithdraw,
      getMarketsChain: mockGetMarketsChain,
      getUserPortfolioFromPositionCapId: mockGetUserPortfolioFromPositionCapId,
    } as unknown as AlphalendClient;
    mockSuiClient = {} as unknown as SuiClient;
    mockLendingLog = {
      logActivity: vi.fn().mockReturnValue(1),
    } as unknown as LendingLog;
  });

  describe('validate', () => {
    let builder: InstanceType<typeof AlphaLendWithdrawBuilder>;

    beforeEach(() => {
      builder = new AlphaLendWithdrawBuilder(mockAlphalendClient, mockSuiClient, mockLendingLog);
    });

    it('allows zero amount when withdrawAll is true', () => {
      const intent = makeWithdrawIntent({ amount: '0', withdrawAll: true });
      expect(() => builder.validate(intent)).not.toThrow();
    });

    it('throws when amount is zero and withdrawAll is not set', () => {
      const intent = makeWithdrawIntent({ amount: '0' });
      expect(() => builder.validate(intent)).toThrow(/amount/i);
    });

    it('does not throw for valid intent', () => {
      expect(() => builder.validate(makeWithdrawIntent())).not.toThrow();
    });
  });

  describe('build', () => {
    it('uses MAX_U64 when withdrawAll is true', async () => {
      const fakeTx = { kind: 'transaction', setSenderIfNotSet: vi.fn() };
      const fakeCapId = '0xcap123';
      mockGetMarketsChain.mockResolvedValue([{ market: { id: 1, coinType: '0x2::sui::SUI' } }]);
      mockGetUserPositionCapId.mockResolvedValue(fakeCapId);
      mockGetUserPortfolioFromPositionCapId.mockResolvedValue({
        borrowedAmounts: new Map(),
        suppliedAmounts: new Map(),
      });
      mockWithdraw.mockResolvedValue(fakeTx);

      const builder = new AlphaLendWithdrawBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockLendingLog,
      );
      const intent = makeWithdrawIntent({ amount: '0', withdrawAll: true });
      const result = await builder.build(intent);

      expect(mockWithdraw).toHaveBeenCalledWith(
        expect.objectContaining({
          positionCapId: fakeCapId,
          amount: BigInt('18446744073709551615'), // MAX_U64
          priceUpdateCoinTypes: ['0x2::sui::SUI'],
        }),
      );
      expect(result.transaction).toBeDefined();
    });

    it('passes priceUpdateCoinTypes with coinType', async () => {
      const fakeTx = { kind: 'transaction', setSenderIfNotSet: vi.fn() };
      const fakeCapId = '0xcap123';
      mockGetMarketsChain.mockResolvedValue([{ market: { id: 1, coinType: '0x2::sui::SUI' } }]);
      mockGetUserPositionCapId.mockResolvedValue(fakeCapId);
      mockGetUserPortfolioFromPositionCapId.mockResolvedValue({
        borrowedAmounts: new Map(),
        suppliedAmounts: new Map(),
      });
      mockWithdraw.mockResolvedValue(fakeTx);

      const builder = new AlphaLendWithdrawBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockLendingLog,
      );
      const intent = makeWithdrawIntent();
      await builder.build(intent);

      expect(mockWithdraw).toHaveBeenCalledWith(
        expect.objectContaining({
          priceUpdateCoinTypes: ['0x2::sui::SUI'],
        }),
      );
    });
  });

  describe('finish', () => {
    it('logs with action withdraw', () => {
      const builder = new AlphaLendWithdrawBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockLendingLog,
      );
      const intent = makeWithdrawIntent();
      const context: FinishContext = {
        intent,
        status: 'approved',
        txDigest: '0xdigest',
        gasUsed: 0.002,
      };

      builder.finish!(context);

      expect(mockLendingLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'withdraw',
          protocol: 'alphalend',
          market_id: '1',
          policy_decision: 'approved',
        }),
      );
    });
  });
});
