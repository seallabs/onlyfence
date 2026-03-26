import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinishContext } from '../core/action-builder.js';
import type { PerpPlaceOrderIntent } from '../core/action-types.js';
import type { ActivityLog } from '../db/activity-log.js';
import type { BluefinClient } from '../chain/sui/bluefin-pro/client.js';
import { BluefinPlaceOrderBuilder } from '../chain/sui/bluefin-pro/place-order.js';

function makePlaceOrderIntent(
  overrides?: Partial<PerpPlaceOrderIntent['params']>,
): PerpPlaceOrderIntent {
  return {
    action: 'perp:place_order',
    chainId: 'sui:mainnet',
    walletAddress: '0x' + 'a'.repeat(64),
    params: {
      marketSymbol: 'BTC-PERP',
      side: 'LONG',
      quantityE9: '1000000000',
      orderType: 'MARKET',
      leverageE9: '5000000000',
      collateralCoinType: '0xusdc::usdc::USDC',
      marketCoinType: '0xbf1b::bluefin_pro::BTC',
      ...overrides,
    },
    valueUsd: 50000,
  };
}

describe('BluefinPlaceOrderBuilder', () => {
  let mockClient: BluefinClient;
  let mockActivityLog: ActivityLog;

  beforeEach(() => {
    mockClient = {
      updateLeverage: vi.fn().mockResolvedValue(undefined),
      createOrder: vi.fn().mockResolvedValue({ orderHash: '0xorderhash123' }),
      waitForOrderEvent: vi
        .fn()
        .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
          await onReady();
          return { status: 'confirmed' as const, orderHash: '0xorderhash123' };
        }),
      getOpenOrders: vi
        .fn()
        .mockResolvedValue([
          { orderHash: '0xorderhash123', clientOrderId: 'mock-will-be-overridden' },
        ]),
    } as unknown as BluefinClient;
    mockActivityLog = {
      logActivity: vi.fn().mockReturnValue(1),
    } as unknown as ActivityLog;
  });

  /** Make getOpenOrders return the order placed via createOrder */
  function setupOpenOrdersToMatchPlacedOrder(): void {
    vi.mocked(mockClient.getOpenOrders).mockImplementation(async () => {
      const calls = vi.mocked(mockClient.createOrder).mock.calls;
      if (calls.length === 0) return [];
      const params = calls[0]![0];
      return [{ orderHash: '0xorderhash123', clientOrderId: params.clientOrderId }] as any;
    });
  }

  it('has correct builderId, chain, and executionStrategy', () => {
    const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
    expect(builder.builderId).toBe('bluefin-pro-place-order');
    expect(builder.chain).toBe('sui');
    expect(builder.executionStrategy).toBe('off-chain-signed');
  });

  describe('validate', () => {
    let builder: BluefinPlaceOrderBuilder;

    beforeEach(() => {
      builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
    });

    it('does not throw for valid MARKET intent', () => {
      expect(() => builder.validate(makePlaceOrderIntent())).not.toThrow();
    });

    it('does not throw for valid LIMIT intent with limitPriceE9', () => {
      expect(() =>
        builder.validate(
          makePlaceOrderIntent({ orderType: 'LIMIT', limitPriceE9: '50000000000000' }),
        ),
      ).not.toThrow();
    });

    it('throws when marketSymbol is empty', () => {
      expect(() => builder.validate(makePlaceOrderIntent({ marketSymbol: '' }))).toThrow(
        /marketSymbol/i,
      );
    });

    it('throws when quantity is zero', () => {
      expect(() => builder.validate(makePlaceOrderIntent({ quantityE9: '0' }))).toThrow(
        /quantity/i,
      );
    });

    it('throws when LIMIT order has no limitPriceE9', () => {
      expect(() =>
        builder.validate(makePlaceOrderIntent({ orderType: 'LIMIT', limitPriceE9: undefined })),
      ).toThrow(/limitPriceE9/i);
    });
  });

  describe('build', () => {
    it('returns null transaction (off-chain builder)', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const result = await builder.build(makePlaceOrderIntent());
      expect(result.transaction).toBeNull();
    });
  });

  describe('execute', () => {
    it('returns confirmed metadata when WS confirms and HTTP verifies', async () => {
      setupOpenOrdersToMatchPlacedOrder();
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent();

      const result = await builder.execute(intent);

      expect(mockClient.updateLeverage).toHaveBeenCalledWith('BTC-PERP', '5000000000');
      expect(mockClient.waitForOrderEvent).toHaveBeenCalledOnce();
      expect(mockClient.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'MARKET',
          symbol: 'BTC-PERP',
          quantityE9: '1000000000',
          side: 'LONG',
          leverageE9: '5000000000',
          priceE9: '0',
          reduceOnly: false,
          timeInForce: 'GTT',
        }),
      );
      expect(mockClient.getOpenOrders).toHaveBeenCalledWith('BTC-PERP');

      expect(result.metadata).toEqual(
        expect.objectContaining({
          marketSymbol: 'BTC-PERP',
          side: 'LONG',
          orderType: 'MARKET',
          orderHash: '0xorderhash123',
        }),
      );
    });

    it('uses limitPriceE9 for LIMIT orders', async () => {
      setupOpenOrdersToMatchPlacedOrder();
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({
        orderType: 'LIMIT',
        limitPriceE9: '50000000000000',
      });
      await builder.execute(intent);

      expect(mockClient.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LIMIT',
          priceE9: '50000000000000',
        }),
      );
    });

    it('passes reduceOnly and timeInForce params', async () => {
      setupOpenOrdersToMatchPlacedOrder();
      // IOC won't be found in open orders, but the IOC path handles that
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([]);

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({
        reduceOnly: true,
        timeInForce: 'IOC',
      });
      await builder.execute(intent);

      expect(mockClient.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          reduceOnly: true,
          timeInForce: 'IOC',
        }),
      );
    });

    it('throws when WS reports order rejected by exchange', async () => {
      vi.mocked(mockClient.waitForOrderEvent).mockImplementation(
        async (_id: string, onReady: () => Promise<void>) => {
          await onReady();
          return { status: 'rejected' as const, reason: 'INSUFFICIENT_MARGIN' };
        },
      );

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent();

      await expect(builder.execute(intent)).rejects.toThrow(
        'Order rejected by exchange: INSUFFICIENT_MARGIN',
      );
      // No HTTP poll on WS rejection
      expect(mockClient.getOpenOrders).not.toHaveBeenCalled();
    });

    it('throws when WS confirms but HTTP poll finds order missing (async cancel)', async () => {
      // WS says confirmed, but order was async-cancelled
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([]);

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent();

      await expect(builder.execute(intent)).rejects.toThrow(
        'Order rejected by exchange: order not found after placement',
      );
    });

    it('verifies via HTTP on timeout and confirms if order found', async () => {
      vi.mocked(mockClient.waitForOrderEvent).mockImplementation(
        async (_id: string, onReady: () => Promise<void>) => {
          await onReady();
          return { status: 'timeout' as const };
        },
      );
      setupOpenOrdersToMatchPlacedOrder();

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent();
      const result = await builder.execute(intent);

      expect(result.metadata['orderHash']).toBe('0xorderhash123');
      expect(mockClient.getOpenOrders).toHaveBeenCalledWith('BTC-PERP');
    });

    it('throws on timeout when HTTP poll finds order missing', async () => {
      vi.mocked(mockClient.waitForOrderEvent).mockImplementation(
        async (_id: string, onReady: () => Promise<void>) => {
          await onReady();
          return { status: 'timeout' as const };
        },
      );
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([]);

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent();

      await expect(builder.execute(intent)).rejects.toThrow(
        'Order rejected by exchange: order not found after placement',
      );
    });

    it('handles IOC order not found in open orders as acknowledged', async () => {
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([]);

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({ timeInForce: 'IOC' });
      const result = await builder.execute(intent);

      expect(result.metadata['note']).toBe(
        'IOC/FOK order processed. Check trade history for fill status.',
      );
      expect(result.metadata['orderHash']).toBe('0xorderhash123');
    });

    it('handles FOK order not found in open orders as acknowledged', async () => {
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([]);

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({ timeInForce: 'FOK' });
      const result = await builder.execute(intent);

      expect(result.metadata['note']).toBe(
        'IOC/FOK order processed. Check trade history for fill status.',
      );
    });

    it('passes the same clientOrderId to waitForOrderEvent and createOrder', async () => {
      setupOpenOrdersToMatchPlacedOrder();
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      await builder.execute(makePlaceOrderIntent());

      const wsClientOrderId = vi.mocked(mockClient.waitForOrderEvent).mock.calls[0]![0];
      const createParams = vi.mocked(mockClient.createOrder).mock.calls[0]![0];
      expect(wsClientOrderId).toBe(createParams.clientOrderId);
    });
  });

  describe('finish', () => {
    it('logs activity on approval with collateral and market coin types', () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent();
      const context: FinishContext = {
        intent,
        status: 'approved',
        metadata: { orderHash: '0xorderhash123', marketSymbol: 'BTC-PERP' },
      };

      builder.finish(context);

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'perp:place_order',
          protocol: 'bluefin_pro',
          policy_decision: 'approved',
          token_a_type: '0xusdc::usdc::USDC',
          token_b_type: '0xbf1b::bluefin_pro::BTC',
          value_usd: 50000,
        }),
      );
    });

    it('logs rejection details', () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent();
      const context: FinishContext = {
        intent,
        status: 'rejected',
        rejection: { check: 'spending_limit', reason: 'too large' },
      };

      builder.finish(context);

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          policy_decision: 'rejected',
          rejection_check: 'spending_limit',
          rejection_reason: 'too large',
        }),
      );
    });
  });
});
