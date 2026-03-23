import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinishContext } from '../core/action-builder.js';
import type { SupplyIntent } from '../core/action-types.js';
import type { ActivityLog } from '../db/activity-log.js';

// Mock AlphaLend SDK
const mockSupply = vi.fn();
const mockGetUserPositionCapId = vi.fn();

vi.mock('@alphafi/alphalend-sdk', () => ({
  AlphalendClient: class MockAlphalendClient {
    supply = mockSupply;
  },
  getUserPositionCapId: (...args: unknown[]) => mockGetUserPositionCapId(...args),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let AlphaLendSupplyBuilder: typeof import('../chain/sui/alphalend/supply.js').AlphaLendSupplyBuilder;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../chain/sui/alphalend/supply.js');
  AlphaLendSupplyBuilder = mod.AlphaLendSupplyBuilder;
});

function makeSupplyIntent(overrides?: Partial<SupplyIntent['params']>): SupplyIntent {
  return {
    action: 'lending:supply',
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

describe('AlphaLendSupplyBuilder', () => {
  let mockAlphalendClient: AlphalendClient;
  let mockSuiClient: SuiClient;
  let mockActivityLog: ActivityLog;

  beforeEach(() => {
    mockAlphalendClient = { supply: mockSupply } as unknown as AlphalendClient;
    mockSuiClient = {} as unknown as SuiClient;
    mockActivityLog = {
      logActivity: vi.fn().mockReturnValue(1),
    } as unknown as ActivityLog;
  });

  it('has correct builderId and chain', () => {
    const builder = new AlphaLendSupplyBuilder(mockAlphalendClient, mockSuiClient, mockActivityLog);
    expect(builder.builderId).toBe('alphalend-supply');
    expect(builder.chain).toBe('sui');
  });

  describe('validate', () => {
    let builder: InstanceType<typeof AlphaLendSupplyBuilder>;

    beforeEach(() => {
      builder = new AlphaLendSupplyBuilder(mockAlphalendClient, mockSuiClient, mockActivityLog);
    });

    it('does not throw for valid intent', () => {
      expect(() => builder.validate(makeSupplyIntent())).not.toThrow();
    });

    it('throws when coinType is empty', () => {
      const intent = makeSupplyIntent({ coinType: '' });
      expect(() => builder.validate(intent)).toThrow(/coinType/i);
    });

    it('throws when amount is zero', () => {
      const intent = makeSupplyIntent({ amount: '0' });
      expect(() => builder.validate(intent)).toThrow(/amount/i);
    });
  });

  describe('build', () => {
    it('calls alphalendClient.supply with correct params and returns BuiltTransaction', async () => {
      const fakeTx = { kind: 'transaction', setSenderIfNotSet: vi.fn() };
      mockGetUserPositionCapId.mockResolvedValue('0xcap123');
      mockSupply.mockResolvedValue(fakeTx);

      const builder = new AlphaLendSupplyBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockActivityLog,
      );
      const intent = makeSupplyIntent();
      const result = await builder.build(intent);

      expect(mockSupply).toHaveBeenCalledWith(
        expect.objectContaining({
          marketId: '1',
          amount: BigInt('1000000000'),
          coinType: '0x2::sui::SUI',
          address: intent.walletAddress,
        }),
      );
      expect(result.transaction).toBeDefined();
      expect(result.metadata).toEqual(
        expect.objectContaining({
          action: 'supply',
          protocol: 'alphalend',
          marketId: '1',
        }),
      );
    });
  });

  describe('finish', () => {
    it('logs activity to ActivityLog on approval', () => {
      const builder = new AlphaLendSupplyBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockActivityLog,
      );
      const intent = makeSupplyIntent();
      const context: FinishContext = {
        intent,
        status: 'approved',
        txDigest: '0xdigest',
        gasUsed: 0.002,
      };

      builder.finish!(context);

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          chain_id: 'sui:mainnet',
          wallet_address: intent.walletAddress,
          action: 'lending:supply',
          protocol: 'alphalend',
          token_a_type: undefined,
          token_a_amount: undefined,
          policy_decision: 'approved',
          tx_digest: '0xdigest',
          gas_cost: 0.002,
          metadata: { market_id: '1' },
        }),
      );
    });

    it('logs on rejection with rejection details', () => {
      const builder = new AlphaLendSupplyBuilder(
        mockAlphalendClient,
        mockSuiClient,
        mockActivityLog,
      );
      const intent = makeSupplyIntent();
      const context: FinishContext = {
        intent,
        status: 'rejected',
        rejection: {
          check: 'spending_limit',
          reason: 'exceeds_single_trade_limit',
        },
      };

      builder.finish!(context);

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'lending:supply',
          policy_decision: 'rejected',
          rejection_check: 'spending_limit',
          rejection_reason: 'exceeds_single_trade_limit',
        }),
      );
    });
  });
});
