import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinishContext } from '../core/action-builder.js';
import type { PerpWithdrawIntent } from '../core/action-types.js';
import type { ActivityLog } from '../db/activity-log.js';
import type { BluefinClient } from '../chain/sui/bluefin-pro/client.js';
import { BluefinWithdrawBuilder } from '../chain/sui/bluefin-pro/withdraw.js';

function makeWithdrawIntent(overrides?: Partial<PerpWithdrawIntent['params']>): PerpWithdrawIntent {
  return {
    action: 'perp:withdraw',
    chainId: 'sui:mainnet',
    walletAddress: '0x' + 'a'.repeat(64),
    params: {
      assetSymbol: 'USDC',
      amountE9: '5000000000',
      ...overrides,
    },
    valueUsd: 5000,
  };
}

describe('BluefinWithdrawBuilder', () => {
  let mockClient: BluefinClient;
  let mockActivityLog: ActivityLog;

  beforeEach(() => {
    mockClient = {
      withdraw: vi.fn().mockResolvedValue(undefined),
    } as unknown as BluefinClient;
    mockActivityLog = {
      logActivity: vi.fn().mockReturnValue(1),
    } as unknown as ActivityLog;
  });

  it('has correct builderId, chain, and executionStrategy', () => {
    const builder = new BluefinWithdrawBuilder(mockClient, mockActivityLog);
    expect(builder.builderId).toBe('bluefin-pro-withdraw');
    expect(builder.chain).toBe('sui');
    expect(builder.executionStrategy).toBe('off-chain-signed');
  });

  describe('validate', () => {
    let builder: BluefinWithdrawBuilder;

    beforeEach(() => {
      builder = new BluefinWithdrawBuilder(mockClient, mockActivityLog);
    });

    it('does not throw for valid intent', () => {
      expect(() => builder.validate(makeWithdrawIntent())).not.toThrow();
    });

    it('throws when amount is zero', () => {
      expect(() => builder.validate(makeWithdrawIntent({ amountE9: '0' }))).toThrow(/amount/i);
    });

    it('throws when assetSymbol is empty', () => {
      expect(() => builder.validate(makeWithdrawIntent({ assetSymbol: '' }))).toThrow(
        /assetSymbol/i,
      );
    });
  });

  describe('build', () => {
    it('returns null transaction (off-chain builder)', async () => {
      const builder = new BluefinWithdrawBuilder(mockClient, mockActivityLog);
      const result = await builder.build(makeWithdrawIntent());
      expect(result.transaction).toBeNull();
    });
  });

  describe('execute', () => {
    it('calls client.withdraw with correct params and returns metadata', async () => {
      const builder = new BluefinWithdrawBuilder(mockClient, mockActivityLog);
      const intent = makeWithdrawIntent();
      const result = await builder.execute(intent);

      expect(mockClient.withdraw).toHaveBeenCalledWith('USDC', '5000000000');
      expect(result.metadata).toEqual({
        assetSymbol: 'USDC',
        amountE9: '5000000000',
      });
    });
  });

  describe('finish', () => {
    it('logs activity on approval', () => {
      const builder = new BluefinWithdrawBuilder(mockClient, mockActivityLog);
      const intent = makeWithdrawIntent();
      const context: FinishContext = {
        intent,
        status: 'approved',
        metadata: { assetSymbol: 'USDC', amountE9: '5000000000' },
      };

      builder.finish(context);

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'perp:withdraw',
          protocol: 'bluefin_pro',
          policy_decision: 'approved',
          value_usd: 5000,
          metadata: context.metadata,
        }),
      );
    });

    it('logs rejection details', () => {
      const builder = new BluefinWithdrawBuilder(mockClient, mockActivityLog);
      const intent = makeWithdrawIntent();
      const context: FinishContext = {
        intent,
        status: 'rejected',
        rejection: { check: 'balance_check', reason: 'insufficient margin' },
      };

      builder.finish(context);

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          policy_decision: 'rejected',
          rejection_check: 'balance_check',
          rejection_reason: 'insufficient margin',
        }),
      );
    });
  });
});
