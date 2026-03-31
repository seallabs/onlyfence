import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinishContext } from '../core/action-builder.js';
import type { PerpCancelOrderIntent } from '../core/action-types.js';
import type { ActivityLog } from '../db/activity-log.js';
import type { BluefinClient } from '../chain/sui/bluefin-pro/client.js';
import { BluefinCancelOrderBuilder } from '../chain/sui/bluefin-pro/cancel-order.js';

function makeCancelIntent(
  overrides?: Partial<PerpCancelOrderIntent['params']>,
): PerpCancelOrderIntent {
  return {
    action: 'perp:cancel_order',
    chainId: 'sui:mainnet',
    walletAddress: '0x' + 'a'.repeat(64),
    params: {
      protocol: 'bluefin_pro',
      marketSymbol: 'BTC-PERP',
      orderHashes: ['0xhash1', '0xhash2'],
      ...overrides,
    },
  };
}

describe('BluefinCancelOrderBuilder', () => {
  let mockClient: BluefinClient;
  let mockActivityLog: ActivityLog;

  beforeEach(() => {
    mockClient = {
      cancelOrders: vi.fn().mockResolvedValue(undefined),
      getOpenOrders: vi.fn().mockResolvedValue([]),
    } as unknown as BluefinClient;
    mockActivityLog = {
      logActivity: vi.fn().mockReturnValue(1),
    } as unknown as ActivityLog;
  });

  it('has correct builderId, chain, and executionStrategy', () => {
    const builder = new BluefinCancelOrderBuilder(mockClient, mockActivityLog);
    expect(builder.builderId).toBe('bluefin-pro-cancel-order');
    expect(builder.chain).toBe('sui');
    expect(builder.executionStrategy).toBe('off-chain-signed');
  });

  describe('validate', () => {
    let builder: BluefinCancelOrderBuilder;

    beforeEach(() => {
      builder = new BluefinCancelOrderBuilder(mockClient, mockActivityLog);
    });

    it('does not throw for valid intent', () => {
      expect(() => builder.validate(makeCancelIntent())).not.toThrow();
    });

    it('throws when marketSymbol is empty', () => {
      expect(() => builder.validate(makeCancelIntent({ marketSymbol: '' }))).toThrow(
        /marketSymbol/i,
      );
    });
  });

  describe('build', () => {
    it('returns null transaction (off-chain builder)', async () => {
      const builder = new BluefinCancelOrderBuilder(mockClient, mockActivityLog);
      const result = await builder.build(makeCancelIntent());
      expect(result.transaction).toBeNull();
    });
  });

  describe('execute', () => {
    it('cancels specific orders by hashes', async () => {
      const builder = new BluefinCancelOrderBuilder(mockClient, mockActivityLog);
      const intent = makeCancelIntent({ orderHashes: ['0xhash1', '0xhash2'] });
      const result = await builder.execute(intent);

      expect(mockClient.cancelOrders).toHaveBeenCalledWith({
        symbol: 'BTC-PERP',
        orderHashes: ['0xhash1', '0xhash2'],
      });
      expect(result.metadata).toEqual({
        marketSymbol: 'BTC-PERP',
        orderHashes: ['0xhash1', '0xhash2'],
        cancelAll: false,
        cancelledCount: 2,
      });
    });

    it('cancels all orders when no hashes provided', async () => {
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([
        { orderHash: '0x1' },
        { orderHash: '0x2' },
        { orderHash: '0x3' },
      ] as any);

      const builder = new BluefinCancelOrderBuilder(mockClient, mockActivityLog);
      const intent = makeCancelIntent({ orderHashes: undefined });
      const result = await builder.execute(intent);

      expect(mockClient.getOpenOrders).toHaveBeenCalledWith('BTC-PERP');
      expect(mockClient.cancelOrders).toHaveBeenCalledWith({
        symbol: 'BTC-PERP',
      });
      expect(result.metadata).toEqual({
        marketSymbol: 'BTC-PERP',
        orderHashes: [],
        cancelAll: true,
        cancelledCount: 3,
      });
    });

    it('cancels all orders when empty hashes array provided', async () => {
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([{ orderHash: '0x1' }] as any);

      const builder = new BluefinCancelOrderBuilder(mockClient, mockActivityLog);
      const intent = makeCancelIntent({ orderHashes: [] });
      const result = await builder.execute(intent);

      expect(result.metadata['cancelAll']).toBe(true);
      expect(result.metadata['cancelledCount']).toBe(1);
    });
  });

  describe('finish', () => {
    it('logs activity on approval', () => {
      const builder = new BluefinCancelOrderBuilder(mockClient, mockActivityLog);
      const intent = makeCancelIntent();
      const context: FinishContext = {
        intent,
        status: 'approved',
        metadata: { marketSymbol: 'BTC-PERP', orderHashes: ['0xhash1'], cancelAll: false },
      };

      builder.finish(context);

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'perp:cancel_order',
          protocol: 'bluefin_pro',
          policy_decision: 'approved',
          metadata: context.metadata,
        }),
      );
    });

    it('logs rejection details', () => {
      const builder = new BluefinCancelOrderBuilder(mockClient, mockActivityLog);
      const intent = makeCancelIntent();
      const context: FinishContext = {
        intent,
        status: 'rejected',
        rejection: { check: 'test', reason: 'denied' },
      };

      builder.finish(context);

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          policy_decision: 'rejected',
          rejection_check: 'test',
          rejection_reason: 'denied',
        }),
      );
    });
  });
});
