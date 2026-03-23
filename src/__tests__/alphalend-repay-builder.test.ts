import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinishContext } from '../core/action-builder.js';
import type { RepayIntent } from '../core/action-types.js';
import type { ActivityLog } from '../db/activity-log.js';

// Mock AlphaLend SDK
const mockRepay = vi.fn();
const mockGetUserPositionCapId = vi.fn();

vi.mock('@alphafi/alphalend-sdk', () => ({
  AlphalendClient: class MockAlphalendClient {
    repay = mockRepay;
  },
  getUserPositionCapId: (...args: unknown[]) => mockGetUserPositionCapId(...args),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let AlphaLendRepayBuilder: typeof import('../chain/sui/alphalend/repay.js').AlphaLendRepayBuilder;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../chain/sui/alphalend/repay.js');
  AlphaLendRepayBuilder = mod.AlphaLendRepayBuilder;
});

function makeRepayIntent(overrides?: Partial<RepayIntent['params']>): RepayIntent {
  return {
    action: 'lending:repay',
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

describe('AlphaLendRepayBuilder', () => {
  let mockAlphalendClient: AlphalendClient;
  let mockSuiClient: SuiClient;
  let mockActivityLog: ActivityLog;

  beforeEach(() => {
    mockAlphalendClient = { repay: mockRepay } as unknown as AlphalendClient;
    mockSuiClient = {} as unknown as SuiClient;
    mockActivityLog = {
      logActivity: vi.fn().mockReturnValue(1),
    } as unknown as ActivityLog;
  });

  describe('build', () => {
    it('applies 1.001 buffer to amount and fetches positionCapId', async () => {
      const fakeTx = { kind: 'transaction', setSenderIfNotSet: vi.fn() };
      const fakeCapId = '0xcap123';
      mockGetUserPositionCapId.mockResolvedValue(fakeCapId);
      mockRepay.mockResolvedValue(fakeTx);

      const builder = new AlphaLendRepayBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockActivityLog,
      );
      const intent = makeRepayIntent({ amount: '1000000000' });
      const result = await builder.build(intent);

      expect(mockGetUserPositionCapId).toHaveBeenCalledWith(
        mockSuiClient,
        expect.any(String),
        intent.walletAddress,
      );

      // 1000000000 * 1.001 = 1001000000 (buffer for accrued interest)
      expect(mockRepay).toHaveBeenCalledWith(
        expect.objectContaining({
          positionCapId: fakeCapId,
          marketId: '1',
          amount: BigInt('1001000000'),
          coinType: '0x2::sui::SUI',
          address: intent.walletAddress,
        }),
      );
      expect(result.transaction).toBeDefined();
      expect(result.metadata).toEqual(
        expect.objectContaining({
          action: 'repay',
          protocol: 'alphalend',
        }),
      );
    });

    it('throws if no position exists', async () => {
      mockGetUserPositionCapId.mockResolvedValue(undefined);

      const builder = new AlphaLendRepayBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockActivityLog,
      );
      await expect(builder.build(makeRepayIntent())).rejects.toThrow(/position/i);
    });
  });

  describe('finish', () => {
    it('logs with action repay', () => {
      const builder = new AlphaLendRepayBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockActivityLog,
      );
      const intent = makeRepayIntent();
      const context: FinishContext = {
        intent,
        status: 'approved',
        txDigest: '0xdigest',
        gasUsed: 0.002,
      };

      builder.finish!(context);

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'lending:repay',
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
