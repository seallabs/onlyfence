import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinishContext } from '../core/action-builder.js';
import type { PerpDepositIntent } from '../core/action-types.js';
import type { ActivityLog } from '../db/activity-log.js';
import type { BluefinClient } from '../chain/sui/bluefin-pro/client.js';
import { BluefinDepositBuilder } from '../chain/sui/bluefin-pro/deposit.js';

function makeDepositIntent(overrides?: Partial<PerpDepositIntent['params']>): PerpDepositIntent {
  return {
    action: 'perp:deposit',
    chainId: 'sui:mainnet',
    walletAddress: '0x' + 'a'.repeat(64),
    params: {
      protocol: 'bluefin_pro',
      coinType: '0xusdc::usdc::USDC',
      amount: '100000', // 0.1 USDC in native scale (6 decimals)
      decimals: 6,
      ...overrides,
    },
    valueUsd: 100,
  };
}

describe('BluefinDepositBuilder', () => {
  let mockClient: BluefinClient;
  let mockActivityLog: ActivityLog;

  beforeEach(() => {
    mockClient = {
      deposit: vi.fn().mockResolvedValue({ digest: '0xtxdigest' }),
    } as unknown as BluefinClient;
    mockActivityLog = {
      logActivity: vi.fn().mockReturnValue(1),
    } as unknown as ActivityLog;
  });

  it('has correct builderId, chain, and executionStrategy', () => {
    const builder = new BluefinDepositBuilder(mockClient, mockActivityLog);
    expect(builder.builderId).toBe('bluefin-pro-deposit');
    expect(builder.chain).toBe('sui');
    expect(builder.executionStrategy).toBe('off-chain-signed');
  });

  describe('validate', () => {
    let builder: BluefinDepositBuilder;

    beforeEach(() => {
      builder = new BluefinDepositBuilder(mockClient, mockActivityLog);
    });

    it('does not throw for valid intent', () => {
      expect(() => builder.validate(makeDepositIntent())).not.toThrow();
    });

    it('throws when coinType is empty', () => {
      expect(() => builder.validate(makeDepositIntent({ coinType: '' }))).toThrow(/coinType/i);
    });

    it('throws when amount is zero', () => {
      expect(() => builder.validate(makeDepositIntent({ amount: '0' }))).toThrow(/amount/i);
    });
  });

  describe('build', () => {
    it('returns null transaction (off-chain builder)', async () => {
      const builder = new BluefinDepositBuilder(mockClient, mockActivityLog);
      const result = await builder.build(makeDepositIntent());
      expect(result.transaction).toBeNull();
      expect(result.metadata).toEqual({});
    });
  });

  describe('execute', () => {
    it('calls client.deposit with native-scaled amount (SDK expects native, not e9)', async () => {
      const builder = new BluefinDepositBuilder(mockClient, mockActivityLog);
      // 1.5 USDC in native scale (6 decimals) = 1500000
      const intent = makeDepositIntent({ amount: '1500000', decimals: 6 });
      const result = await builder.execute(intent);

      // SDK deposit() expects native unit despite its misleading "amountE9" param name
      expect(mockClient.deposit).toHaveBeenCalledWith('1500000');
      expect(result.metadata).toEqual(
        expect.objectContaining({
          coinType: '0xusdc::usdc::USDC',
          amount: '1500000',
          amountE9: '1500000000',
        }),
      );
    });

    it('omits txDigest when SDK result has no digest', async () => {
      (mockClient.deposit as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const builder = new BluefinDepositBuilder(mockClient, mockActivityLog);
      const result = await builder.execute(makeDepositIntent());

      expect(result.metadata['txDigest']).toBeUndefined();
    });
  });

  describe('finish', () => {
    it('logs activity on approval', () => {
      const builder = new BluefinDepositBuilder(mockClient, mockActivityLog);
      const intent = makeDepositIntent();
      const context: FinishContext = {
        intent,
        status: 'approved',
        metadata: { amountE9: '100000000000' },
      };

      builder.finish(context);

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          chain_id: 'sui:mainnet',
          action: 'perp:deposit',
          protocol: 'bluefin_pro',
          policy_decision: 'approved',
          token_a_type: '0xusdc::usdc::USDC',
          value_usd: 100,
        }),
      );
    });

    it('logs rejection details', () => {
      const builder = new BluefinDepositBuilder(mockClient, mockActivityLog);
      const intent = makeDepositIntent();
      const context: FinishContext = {
        intent,
        status: 'rejected',
        rejection: { check: 'spending_limit', reason: 'exceeds limit' },
      };

      builder.finish(context);

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          policy_decision: 'rejected',
          rejection_check: 'spending_limit',
          rejection_reason: 'exceeds limit',
        }),
      );
    });
  });
});
