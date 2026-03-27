import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock SDK functions and classes
const mockInitialize = vi.fn();
const mockGetExchangeInfo = vi.fn();
const mockGetAccountDetails = vi.fn();
const mockGetOpenOrders = vi.fn();
const mockGetAccountTrades = vi.fn();
const mockGetAccountFundingRateHistory = vi.fn();
const mockGetFundingRateHistory = vi.fn();
const mockCreateOrder = vi.fn();
const mockCancelOrder = vi.fn();
const mockDeposit = vi.fn();
const mockWithdraw = vi.fn();
const mockUpdateLeverage = vi.fn();
const mockDispose = vi.fn();
const mockCreateAccountDataStreamListener = vi.fn();
const mockGetAccountPreferences = vi.fn();

vi.mock('@bluefin-exchange/pro-sdk', () => ({
  BluefinProSdk: class MockBluefinProSdk {
    initialize = mockInitialize;
    exchangeDataApi = {
      getExchangeInfo: mockGetExchangeInfo,
      getFundingRateHistory: mockGetFundingRateHistory,
    };
    accountDataApi = {
      getAccountDetails: mockGetAccountDetails,
      getAccountTrades: mockGetAccountTrades,
      getAccountFundingRateHistory: mockGetAccountFundingRateHistory,
    };
    getOpenOrders = mockGetOpenOrders;
    createOrder = mockCreateOrder;
    cancelOrder = mockCancelOrder;
    deposit = mockDeposit;
    withdraw = mockWithdraw;
    updateLeverage = mockUpdateLeverage;
    dispose = mockDispose;
    createAccountDataStreamListener = mockCreateAccountDataStreamListener;
    getAccountPreferences = mockGetAccountPreferences;
  },
  BluefinRequestSigner: class MockSigner {},
  AccountDataStream: {
    AccountOrderUpdate: 'AccountOrderUpdate',
    AccountCommandFailureUpdate: 'AccountCommandFailureUpdate',
    AccountTradeUpdate: 'AccountTradeUpdate',
    AccountAggregatedTradeUpdate: 'AccountAggregatedTradeUpdate',
    AccountPositionUpdate: 'AccountPositionUpdate',
    AccountUpdate: 'AccountUpdate',
    AccountTransactionUpdate: 'AccountTransactionUpdate',
  },
  makeSigner: vi.fn().mockReturnValue({}),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let BluefinClient: typeof import('../chain/sui/bluefin-pro/client.js').BluefinClient;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../chain/sui/bluefin-pro/client.js');
  BluefinClient = mod.BluefinClient;
});

function makeClient() {
  return new BluefinClient({
    network: 'testnet',
    suiClient: {} as any,
    keypair: {} as any,
  });
}

describe('BluefinClient', () => {
  describe('auto-initialization', () => {
    it('auto-initializes SDK on first method call', async () => {
      mockGetExchangeInfo.mockResolvedValue({ data: { markets: [] } });
      const client = makeClient();
      await client.getExchangeInfo();
      expect(mockInitialize).toHaveBeenCalledOnce();
    });

    it('does not re-initialize on subsequent calls', async () => {
      mockGetExchangeInfo.mockResolvedValue({ data: { markets: [] } });
      const client = makeClient();
      await client.getExchangeInfo();
      await client.getExchangeInfo();
      expect(mockInitialize).toHaveBeenCalledOnce();
    });
  });

  describe('getExchangeInfo', () => {
    it('returns exchange info data', async () => {
      const fakeInfo = { markets: ['BTC-PERP'] };
      mockGetExchangeInfo.mockResolvedValue({ data: fakeInfo });
      const client = makeClient();

      const result = await client.getExchangeInfo();
      expect(result).toEqual(fakeInfo);
      expect(mockGetExchangeInfo).toHaveBeenCalledOnce();
    });
  });

  describe('getAccountDetails', () => {
    it('returns account data', async () => {
      const fakeAccount = { balance: '1000000000' };
      mockGetAccountDetails.mockResolvedValue({ data: fakeAccount });
      const client = makeClient();

      const result = await client.getAccountDetails();
      expect(result).toEqual(fakeAccount);
    });
  });

  describe('getOpenOrders', () => {
    it('returns open orders', async () => {
      const fakeOrders = [{ hash: '0x1', symbol: 'BTC-PERP' }];
      mockGetOpenOrders.mockResolvedValue({ data: fakeOrders });
      const client = makeClient();

      const result = await client.getOpenOrders('BTC-PERP');
      expect(result).toEqual(fakeOrders);
      expect(mockGetOpenOrders).toHaveBeenCalledWith('BTC-PERP');
    });

    it('passes undefined symbol when not specified', async () => {
      mockGetOpenOrders.mockResolvedValue({ data: [] });
      const client = makeClient();

      await client.getOpenOrders();
      expect(mockGetOpenOrders).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getTrades', () => {
    it('returns trades with filters', async () => {
      const fakeTrades = [{ tradeId: 't1' }];
      mockGetAccountTrades.mockResolvedValue({ data: fakeTrades });
      const client = makeClient();

      const result = await client.getTrades({
        symbol: 'BTC-PERP',
        startTimeAtMillis: 1000,
        endTimeAtMillis: 2000,
        limit: 50,
      });
      expect(result).toEqual(fakeTrades);
      expect(mockGetAccountTrades).toHaveBeenCalledWith('BTC-PERP', 1000, 2000, 50);
    });

    it('passes undefined for missing optional params', async () => {
      mockGetAccountTrades.mockResolvedValue({ data: [] });
      const client = makeClient();

      await client.getTrades();
      expect(mockGetAccountTrades).toHaveBeenCalledWith(undefined, undefined, undefined, undefined);
    });
  });

  describe('getFundingRateHistory', () => {
    it('returns exchange-level funding rate history', async () => {
      const fakeEntries = [
        { symbol: 'BTC-PERP', fundingTimeAtMillis: 1000, fundingRateE9: '100000' },
      ];
      mockGetFundingRateHistory.mockResolvedValue({ data: fakeEntries });
      const client = makeClient();

      const result = await client.getFundingRateHistory({ symbol: 'BTC-PERP', limit: 10 });
      expect(result).toEqual(fakeEntries);
      expect(mockGetFundingRateHistory).toHaveBeenCalledWith(
        'BTC-PERP',
        10,
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('getAccountFundingRateHistory', () => {
    it('returns account-level funding payment history', async () => {
      const fakeHistory = { data: [{ paymentAmountE9: '500000', symbol: 'BTC-PERP' }] };
      mockGetAccountFundingRateHistory.mockResolvedValue({ data: fakeHistory });
      const client = makeClient();

      const result = await client.getAccountFundingRateHistory({ limit: 5 });
      expect(result).toEqual(fakeHistory);
      expect(mockGetAccountFundingRateHistory).toHaveBeenCalledWith(
        undefined,
        5,
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('createOrder', () => {
    it('places an order through SDK', async () => {
      const orderResult = { orderHash: '0xorder' };
      mockCreateOrder.mockResolvedValue(orderResult);
      const client = makeClient();

      const params = {
        symbol: 'BTC-PERP',
        side: 'BUY',
        quantity: '1000000000',
        orderType: 'MARKET',
      };
      const result = await client.createOrder(params as any);
      expect(result).toEqual(orderResult);
      expect(mockCreateOrder).toHaveBeenCalledWith(params);
    });
  });

  describe('cancelOrders', () => {
    it('cancels orders through SDK', async () => {
      mockCancelOrder.mockResolvedValue(undefined);
      const client = makeClient();

      const request = { symbol: 'BTC-PERP', orderHashes: ['0xhash1'] };
      await client.cancelOrders(request as any);
      expect(mockCancelOrder).toHaveBeenCalledWith(request);
    });
  });

  describe('deposit', () => {
    it('deposits through SDK', async () => {
      const txResult = { digest: '0xtx' };
      mockDeposit.mockResolvedValue(txResult);
      const client = makeClient();

      const result = await client.deposit('10000000000');
      expect(result).toEqual(txResult);
      expect(mockDeposit).toHaveBeenCalledWith('10000000000');
    });
  });

  describe('withdraw', () => {
    it('withdraws through SDK', async () => {
      mockWithdraw.mockResolvedValue(undefined);
      const client = makeClient();

      await client.withdraw('USDC', '5000000000');
      expect(mockWithdraw).toHaveBeenCalledWith('USDC', '5000000000');
    });
  });

  describe('updateLeverage', () => {
    it('updates leverage through SDK', async () => {
      mockUpdateLeverage.mockResolvedValue(undefined);
      const client = makeClient();

      await client.updateLeverage('BTC-PERP', '10000000000');
      expect(mockUpdateLeverage).toHaveBeenCalledWith('BTC-PERP', '10000000000');
    });
  });

  describe('getAccountPreferences', () => {
    it('returns account preferences data', async () => {
      const fakePrefs = {
        market: [{ marginType: 'CROSS', setLeverage: 10 }],
      };
      mockGetAccountPreferences.mockResolvedValue({ data: fakePrefs });
      const client = makeClient();

      const result = await client.getAccountPreferences();
      expect(result).toEqual(fakePrefs);
      expect(mockGetAccountPreferences).toHaveBeenCalledOnce();
    });
  });

  describe('dispose', () => {
    it('disposes SDK and resets initialized state', async () => {
      mockDispose.mockResolvedValue(undefined);
      mockGetExchangeInfo.mockResolvedValue({ data: { markets: [] } });
      const client = makeClient();
      // Trigger auto-init
      await client.getExchangeInfo();
      expect(mockInitialize).toHaveBeenCalledOnce();

      await client.dispose();
      expect(mockDispose).toHaveBeenCalledOnce();

      // After dispose, next call should re-initialize
      await client.getExchangeInfo();
      expect(mockInitialize).toHaveBeenCalledTimes(2);
    });
  });

  describe('waitForOrderEvent', () => {
    const mockWs = { close: vi.fn(), send: vi.fn().mockResolvedValue(undefined) };
    const noopReady = async (): Promise<void> => {};

    beforeEach(() => {
      mockWs.close.mockReset();
      mockWs.send.mockReset().mockResolvedValue(undefined);
    });

    function setupWsListener(
      events: Array<{ event: string; payload: Record<string, unknown> }>,
      delayMs = 0,
    ): void {
      mockCreateAccountDataStreamListener.mockImplementation(
        async (handler: (msg: unknown) => Promise<void>) => {
          for (const evt of events) {
            setTimeout(() => void handler(evt), delayMs);
          }
          return mockWs;
        },
      );
    }

    it('resolves as confirmed when OPEN event arrives', async () => {
      setupWsListener([
        {
          event: 'AccountOrderUpdate',
          payload: { clientOrderId: 'order-1', status: 'OPEN', orderHash: '0xabc' },
        },
      ]);

      const client = makeClient();
      const result = await client.waitForOrderEvent('order-1', noopReady, 10_000);

      expect(result).toEqual({ status: 'confirmed', orderHash: '0xabc' });
      expect(mockWs.close).toHaveBeenCalled();
    });

    it('resolves as rejected when cancellationReason event arrives', async () => {
      setupWsListener([
        {
          event: 'AccountOrderUpdate',
          payload: {
            clientOrderId: 'order-3',
            cancellationReason: 'INSUFFICIENT_MARGIN',
            orderHash: '0xghi',
          },
        },
      ]);

      const client = makeClient();
      const result = await client.waitForOrderEvent('order-3', noopReady, 10_000);

      expect(result).toEqual({
        status: 'rejected',
        orderHash: '0xghi',
        reason: 'INSUFFICIENT_MARGIN',
      });
    });

    it('resolves as confirmed for FILLED status', async () => {
      setupWsListener([
        {
          event: 'AccountOrderUpdate',
          payload: { clientOrderId: 'order-4', status: 'FILLED', orderHash: '0xjkl' },
        },
      ]);

      const client = makeClient();
      const result = await client.waitForOrderEvent('order-4', noopReady, 10_000);

      expect(result).toEqual({ status: 'confirmed', orderHash: '0xjkl' });
    });

    it('resolves as rejected when CANCELLED status arrives', async () => {
      setupWsListener([
        {
          event: 'AccountOrderUpdate',
          payload: { clientOrderId: 'order-2', status: 'CANCELLED', orderHash: '0xdef' },
        },
      ]);

      const client = makeClient();
      const result = await client.waitForOrderEvent('order-2', noopReady, 10_000);

      expect(result).toEqual({
        status: 'rejected',
        orderHash: '0xdef',
        reason: 'CANCELLED',
      });
    });

    it('resolves as timeout when no events arrive', async () => {
      mockCreateAccountDataStreamListener.mockImplementation(async () => mockWs);

      const client = makeClient();
      const result = await client.waitForOrderEvent('order-5', noopReady, 100);

      expect(result).toEqual({ status: 'timeout' });
      expect(mockWs.close).toHaveBeenCalled();
    });

    it('ignores events for different clientOrderId', async () => {
      mockCreateAccountDataStreamListener.mockImplementation(
        async (handler: (msg: unknown) => Promise<void>) => {
          setTimeout(
            () =>
              void handler({
                event: 'AccountOrderUpdate',
                payload: {
                  clientOrderId: 'other-order',
                  status: 'OPEN',
                  orderHash: '0xother',
                },
              }),
            0,
          );
          return mockWs;
        },
      );

      const client = makeClient();
      const result = await client.waitForOrderEvent('order-6', noopReady, 200);

      expect(result).toEqual({ status: 'timeout' });
    });

    it('resolves as rejected when AccountCommandFailureUpdate arrives', async () => {
      setupWsListener([
        {
          event: 'AccountCommandFailureUpdate',
          payload: { reason: 'Internal error' },
        },
      ]);

      const client = makeClient();
      const result = await client.waitForOrderEvent('order-7', noopReady, 10_000);

      expect(result).toEqual({ status: 'rejected', reason: 'Internal error' });
    });

    it('resolves as rejected when WS connection fails', async () => {
      mockCreateAccountDataStreamListener.mockRejectedValue(new Error('Connection refused'));

      const client = makeClient();
      const result = await client.waitForOrderEvent('order-8', noopReady, 10_000);

      expect(result).toEqual({
        status: 'rejected',
        reason: 'WebSocket connection failed: Connection refused',
      });
    });

    it('calls onReady after WS is connected', async () => {
      const callOrder: string[] = [];
      mockCreateAccountDataStreamListener.mockImplementation(async () => {
        callOrder.push('ws-connected');
        return mockWs;
      });

      const client = makeClient();
      await client.waitForOrderEvent(
        'order-9',
        async () => {
          callOrder.push('onReady');
        },
        100,
      );

      expect(callOrder).toEqual(['ws-connected', 'onReady']);
    });
  });
});
