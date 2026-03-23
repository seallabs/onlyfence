import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinishContext } from '../core/action-builder.js';
import type { ClaimRewardsIntent } from '../core/action-types.js';
import type { ActivityLog } from '../db/activity-log.js';

// Mock AlphaLend SDK
const mockClaimRewards = vi.fn();
const mockGetUserPositionCapId = vi.fn();

vi.mock('@alphafi/alphalend-sdk', () => ({
  AlphalendClient: class MockAlphalendClient {
    claimRewards = mockClaimRewards;
  },
  getUserPositionCapId: (...args: unknown[]) => mockGetUserPositionCapId(...args),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let AlphaLendClaimRewardsBuilder: typeof import('../chain/sui/alphalend/claim-rewards.js').AlphaLendClaimRewardsBuilder;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../chain/sui/alphalend/claim-rewards.js');
  AlphaLendClaimRewardsBuilder = mod.AlphaLendClaimRewardsBuilder;
});

function makeClaimRewardsIntent(): ClaimRewardsIntent {
  return {
    action: 'lending:claim_rewards',
    chainId: 'sui:mainnet',
    walletAddress: '0x' + 'a'.repeat(64),
    params: {
      protocol: 'alphalend',
    },
  };
}

describe('AlphaLendClaimRewardsBuilder', () => {
  let mockAlphalendClient: AlphalendClient;
  let mockSuiClient: SuiClient;
  let mockActivityLog: ActivityLog;

  beforeEach(() => {
    mockAlphalendClient = {
      claimRewards: mockClaimRewards,
    } as unknown as AlphalendClient;
    mockSuiClient = {} as unknown as SuiClient;
    mockActivityLog = {
      logActivity: vi.fn().mockReturnValue(1),
    } as unknown as ActivityLog;
  });

  describe('validate', () => {
    it('does not throw (no params to validate)', () => {
      const builder = new AlphaLendClaimRewardsBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockActivityLog,
      );
      expect(() => builder.validate(makeClaimRewardsIntent())).not.toThrow();
    });
  });

  describe('build', () => {
    it('fetches positionCapId and calls claimRewards', async () => {
      const fakeTx = { kind: 'transaction', setSenderIfNotSet: vi.fn() };
      const fakeCapId = '0xcap123';
      mockGetUserPositionCapId.mockResolvedValue(fakeCapId);
      mockClaimRewards.mockResolvedValue(fakeTx);

      const builder = new AlphaLendClaimRewardsBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockActivityLog,
      );
      const intent = makeClaimRewardsIntent();
      const result = await builder.build(intent);

      expect(mockGetUserPositionCapId).toHaveBeenCalledWith(
        mockSuiClient,
        expect.any(String),
        intent.walletAddress,
      );
      expect(mockClaimRewards).toHaveBeenCalledWith(
        expect.objectContaining({
          positionCapId: fakeCapId,
          address: intent.walletAddress,
          claimAndDepositAlpha: false,
          claimAndDepositAll: false,
        }),
      );
      expect(result.transaction).toBeDefined();
      expect(result.metadata).toEqual(
        expect.objectContaining({
          action: 'claim_rewards',
          protocol: 'alphalend',
        }),
      );
    });

    it('throws if no position exists', async () => {
      mockGetUserPositionCapId.mockResolvedValue(undefined);

      const builder = new AlphaLendClaimRewardsBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockActivityLog,
      );
      await expect(builder.build(makeClaimRewardsIntent())).rejects.toThrow(/position/i);
    });
  });

  describe('finish', () => {
    it('logs with nullable coin_type, token_symbol, and amount', () => {
      const builder = new AlphaLendClaimRewardsBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockActivityLog,
      );
      const intent = makeClaimRewardsIntent();
      const context: FinishContext = {
        intent,
        status: 'approved',
        txDigest: '0xdigest',
        gasUsed: 0.002,
      };

      builder.finish!(context);

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'lending:claim_rewards',
          protocol: 'alphalend',
          policy_decision: 'approved',
          tx_digest: '0xdigest',
          gas_cost: 0.002,
        }),
      );

      // claim_rewards has no token params — early return before token-amount path
      const logCall = (mockActivityLog.logActivity as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as Record<string, unknown>;
      expect(logCall['token_a_type']).toBeUndefined();
      expect(logCall['token_a_amount']).toBeUndefined();
    });
  });
});
