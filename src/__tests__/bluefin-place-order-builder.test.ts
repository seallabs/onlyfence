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
      protocol: 'bluefin_pro',
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
      getAccountDetails: vi.fn().mockResolvedValue({ positions: [] }),
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
      getTrades: vi.fn().mockResolvedValue([]),
      getExchangeInfo: vi.fn().mockResolvedValue({
        markets: [
          {
            symbol: 'BTC-PERP',
            status: 'TRADING',
            minOrderQuantityE9: '1000000',
            maxLimitOrderQuantityE9: '100000000000',
            tickSizeE9: '100000000',
            stepSizeE9: '1000000',
            defaultLeverageE9: '3000000000',
            defaultMakerFeeE9: '200000',
            defaultTakerFeeE9: '500000',
            minOrderPriceE9: '100000000',
            maxOrderPriceE9: '1000000000000000',
            maxNotionalAtOpenE9: Array.from({ length: 20 }, () => '1000000000000'),
          },
        ],
      }),
    } as unknown as BluefinClient;
    mockActivityLog = {
      logActivity: vi.fn().mockReturnValue(1),
    } as unknown as ActivityLog;
  });

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
    it('market order uses WS confirmation and returns success without HTTP poll', async () => {
      // Market orders fill instantly → become positions, not open orders.
      // WS confirms, skip HTTP poll, return success directly.
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent();

      const result = await builder.execute(intent);

      expect(mockClient.getExchangeInfo).toHaveBeenCalledOnce();
      expect(mockClient.waitForOrderEvent).toHaveBeenCalledOnce();
      // Market orders should NOT poll open orders
      expect(mockClient.getOpenOrders).not.toHaveBeenCalled();
      const createOrderCall = vi.mocked(mockClient.createOrder).mock.calls[0]![0];
      expect(createOrderCall).toEqual(
        expect.objectContaining({
          type: 'MARKET',
          symbol: 'BTC-PERP',
          quantityE9: '1000000000',
          side: 'LONG',
          leverageE9: '5000000000',
          priceE9: '0',
          reduceOnly: false,
        }),
      );
      expect(result.metadata).toEqual(
        expect.objectContaining({
          marketSymbol: 'BTC-PERP',
          side: 'LONG',
          orderType: 'MARKET',
        }),
      );
    });

    it('limit order uses WS confirmation and returns success without HTTP poll', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({
        orderType: 'LIMIT',
        limitPriceE9: '50000000000000',
      });

      const result = await builder.execute(intent);

      expect(mockClient.waitForOrderEvent).toHaveBeenCalledOnce();
      // No HTTP poll — trust WS confirmation
      expect(mockClient.getOpenOrders).not.toHaveBeenCalled();
      expect(result.metadata).toEqual(
        expect.objectContaining({
          orderType: 'LIMIT',
          orderHash: '0xorderhash123',
        }),
      );
    });

    it('uses limitPriceE9 for LIMIT orders', async () => {
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

    it('passes reduceOnly and timeInForce params for LIMIT orders', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({
        orderType: 'LIMIT',
        limitPriceE9: '50000000000000',
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

    it('submits market orders with MARKET type and price=0, no TIF', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent(); // default is MARKET
      await builder.execute(intent);

      const call = vi.mocked(mockClient.createOrder).mock.calls[0]![0];
      expect(call.type).toBe('MARKET');
      expect(call.priceE9).toBe('0');
      expect(call.timeInForce).toBeUndefined();
    });

    it('uses market default leverage when user omits leverage', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent();
      // Remove explicit leverage
      (intent as { params: Record<string, unknown> }).params.leverageE9 = undefined;

      await builder.execute(intent);

      // Mock market has defaultLeverageE9 = '3000000000' (3x)
      expect(mockClient.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          leverageE9: '3000000000',
        }),
      );
    });

    it('throws when leverage exceeds market maximum', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      // Mock market has 20 leverage tiers → max 20x
      const intent = makePlaceOrderIntent({ leverageE9: '25000000000' }); // 25x

      await expect(builder.execute(intent)).rejects.toThrow(
        'Leverage 25x exceeds maximum 20x for BTC-PERP',
      );
    });

    it('throws when leverage is zero', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({ leverageE9: '0' });

      await expect(builder.execute(intent)).rejects.toThrow('Leverage must be greater than zero');
    });

    it('throws when quantity is below market minimum', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      // Mock market minOrderQuantityE9 = '1000000' (0.001)
      const intent = makePlaceOrderIntent({ quantityE9: '500000' }); // 0.0005

      await expect(builder.execute(intent)).rejects.toThrow(/below minimum/);
    });

    it('throws when quantity exceeds market maximum', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      // Mock market maxLimitOrderQuantityE9 = '100000000000' (100)
      const intent = makePlaceOrderIntent({ quantityE9: '200000000000000' }); // 200000

      await expect(builder.execute(intent)).rejects.toThrow(/exceeds maximum/);
    });

    it('throws when quantity is not a multiple of step size', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      // Mock market stepSizeE9 = '1000000' (0.001)
      const intent = makePlaceOrderIntent({ quantityE9: '1500500' }); // not a multiple

      await expect(builder.execute(intent)).rejects.toThrow(/not a multiple of step size/);
    });

    it('throws when limit price is not a multiple of tick size', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      // Mock market tickSizeE9 = '100000000' (0.1)
      const intent = makePlaceOrderIntent({
        orderType: 'LIMIT',
        limitPriceE9: '50050000000', // $50.05 — not a multiple of 0.1
      });

      await expect(builder.execute(intent)).rejects.toThrow(/not a multiple of tick size/);
    });

    it('accepts limit price that is a valid multiple of tick size', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      // Mock market tickSizeE9 = '100000000' (0.1)
      const intent = makePlaceOrderIntent({
        orderType: 'LIMIT',
        limitPriceE9: '50100000000', // $50.1 — valid multiple of 0.1
      });

      const result = await builder.execute(intent);
      expect(result.metadata['priceE9']).toBe('50100000000');
    });

    it('throws when WS reports limit order rejected by exchange', async () => {
      vi.mocked(mockClient.waitForOrderEvent).mockImplementation(
        async (_id: string, onReady: () => Promise<void>) => {
          await onReady();
          return { status: 'rejected' as const, reason: 'INSUFFICIENT_MARGIN' };
        },
      );

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({
        orderType: 'LIMIT',
        limitPriceE9: '50000000000000',
      });

      await expect(builder.execute(intent)).rejects.toThrow(
        'Order rejected by exchange: INSUFFICIENT_MARGIN',
      );
      // No HTTP poll on WS rejection
      expect(mockClient.getOpenOrders).not.toHaveBeenCalled();
    });

    it('returns success with note on WS timeout (no HTTP poll)', async () => {
      vi.mocked(mockClient.waitForOrderEvent).mockImplementation(
        async (_id: string, onReady: () => Promise<void>) => {
          await onReady();
          return { status: 'timeout' as const };
        },
      );

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({
        orderType: 'LIMIT',
        limitPriceE9: '50000000000000',
      });
      const result = await builder.execute(intent);

      expect(result.metadata['note']).toBe(
        'Order submitted but WS confirmation timed out. Verify with: fence perp orders',
      );
      // No HTTP poll on timeout
      expect(mockClient.getOpenOrders).not.toHaveBeenCalled();
    });

    it('IOC limit order with WS confirmed returns success', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({
        orderType: 'LIMIT',
        limitPriceE9: '50000000000000',
        timeInForce: 'IOC',
      });
      const result = await builder.execute(intent);

      // WS confirmed → success, no HTTP poll
      expect(mockClient.getOpenOrders).not.toHaveBeenCalled();
      expect(result.metadata['orderHash']).toBe('0xorderhash123');
      expect(result.metadata['timeInForce']).toBe('IOC');
    });

    it('FOK limit order with WS confirmed returns success', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({
        orderType: 'LIMIT',
        limitPriceE9: '50000000000000',
        timeInForce: 'FOK',
      });
      const result = await builder.execute(intent);

      // WS confirmed → success, no HTTP poll
      expect(mockClient.getOpenOrders).not.toHaveBeenCalled();
      expect(result.metadata['orderHash']).toBe('0xorderhash123');
      expect(result.metadata['timeInForce']).toBe('FOK');
    });

    it('passes the same clientOrderId to waitForOrderEvent and createOrder for limit orders', async () => {
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      await builder.execute(
        makePlaceOrderIntent({ orderType: 'LIMIT', limitPriceE9: '50000000000000' }),
      );

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
