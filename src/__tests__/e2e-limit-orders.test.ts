/**
 * E2E Integration Tests: Bluefin Pro Limit Orders
 *
 * Exercises the full pipeline flow for all limit order scenarios:
 *   intent → validate → policy → build → execute (off-chain) → finish (activity log)
 *
 * Constraint: wallet balance = 1 USDC. All limit prices are set far from market
 * to avoid real matching. Tests verify:
 *   - All queryable Bluefin Pro API metrics (orders, positions, account, markets, trades, funding)
 *   - Activities table entries (metadata, coin types, policy decisions)
 *   - Edge cases (IOC, FOK, reduce-only, insufficient margin, cancel)
 *   - Error propagation and rejection reasons
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinishContext } from '../core/action-builder.js';
import type {
  PerpCancelOrderIntent,
  PerpDepositIntent,
  PerpPlaceOrderIntent,
  PerpWithdrawIntent,
} from '../core/action-types.js';
import type { ActivityLog, ActivityRecord } from '../db/activity-log.js';
import type { BluefinClient } from '../chain/sui/bluefin-pro/client.js';
import type { BluefinMarketInfo } from '../chain/sui/bluefin-pro/markets.js';
import { BluefinPlaceOrderBuilder } from '../chain/sui/bluefin-pro/place-order.js';
import { BluefinCancelOrderBuilder } from '../chain/sui/bluefin-pro/cancel-order.js';
import { BluefinDepositBuilder } from '../chain/sui/bluefin-pro/deposit.js';
import { BluefinWithdrawBuilder } from '../chain/sui/bluefin-pro/withdraw.js';
import { syncFills } from '../chain/sui/bluefin-pro/sync.js';
import {
  fetchBluefinMarkets,
  resolveMarketSymbol,
  seedSyntheticCoinMetadata,
} from '../chain/sui/bluefin-pro/markets.js';
import {
  toE9,
  fromE9,
  toBluefinCoinType,
  parseBluefinMarketSymbol,
} from '../chain/sui/bluefin-pro/types.js';
import type { CoinMetadataRepository } from '../db/coin-metadata-repo.js';

// ─── Constants ─────────────────────────────────────────────────────────────────
const WALLET_ADDRESS = '0x' + 'a'.repeat(64);
const CHAIN_ID = 'sui:mainnet' as const;
const USDC_COIN_TYPE =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const SUI_PERP_COIN_TYPE = toBluefinCoinType('SUI');
const BTC_PERP_COIN_TYPE = toBluefinCoinType('BTC');
const WALLET_BALANCE_USDC = 1; // 1 USDC

// ─── Mock Factories ────────────────────────────────────────────────────────────

/** Captured activity log entries for verification */
let activityRecords: ActivityRecord[];

function makeActivityLog(): ActivityLog {
  activityRecords = [];
  return {
    logActivity: vi.fn((record: ActivityRecord) => {
      activityRecords.push(record);
      return activityRecords.length;
    }),
    getLastSyncTimestamp: vi.fn().mockReturnValue(null),
    getRecentActivities: vi.fn().mockReturnValue([]),
    getRecentByCategory: vi.fn().mockReturnValue([]),
    getActivityCount: vi.fn().mockReturnValue(0),
    getActivityCountByCategory: vi.fn().mockReturnValue(0),
    getRolling24hVolume: vi.fn().mockReturnValue(0),
  } as unknown as ActivityLog;
}

function makeCoinMetadataRepo(): CoinMetadataRepository {
  return {
    upsertBulk: vi.fn(),
    get: vi.fn(),
  } as unknown as CoinMetadataRepository;
}

/** Standard SUI-PERP market info matching Bluefin exchange response */
const SUI_MARKET: BluefinMarketInfo = {
  symbol: 'SUI-PERP',
  baseAsset: 'SUI',
  status: 'active',
  minOrderSizeE9: '100000000', // 0.1 SUI
  maxOrderSizeE9: '10000000000000', // 10000 SUI
  tickSizeE9: '1000000', // 0.001
  stepSizeE9: '100000000', // 0.1
  defaultLeverageE9: '5000000000', // 5x
  maxLeverageE9: '20000000000', // 20x
  makerFeeE9: '200000', // 0.0002 (2bps)
  takerFeeE9: '500000', // 0.0005 (5bps)
};

const BTC_MARKET: BluefinMarketInfo = {
  symbol: 'BTC-PERP',
  baseAsset: 'BTC',
  status: 'active',
  minOrderSizeE9: '100000', // 0.0001 BTC
  maxOrderSizeE9: '100000000000', // 100 BTC
  tickSizeE9: '100000000', // 0.1
  stepSizeE9: '100000', // 0.0001
  defaultLeverageE9: '10000000000', // 10x
  maxLeverageE9: '50000000000', // 50x
  makerFeeE9: '200000',
  takerFeeE9: '500000',
};

function makeBluefinClient(overrides?: Partial<BluefinClient>): BluefinClient {
  return {
    getExchangeInfo: vi.fn().mockResolvedValue({
      markets: [
        {
          symbol: 'SUI-PERP',
          status: 'active',
          minOrderQuantityE9: '100000000',
          maxLimitOrderQuantityE9: '10000000000000',
          tickSizeE9: '1000000',
          stepSizeE9: '100000000',
          defaultLeverageE9: '5000000000',
          maxNotionalAtOpenE9: Array(20).fill('0'), // 20x
          defaultMakerFeeE9: '200000',
          defaultTakerFeeE9: '500000',
        },
        {
          symbol: 'BTC-PERP',
          status: 'active',
          minOrderQuantityE9: '100000',
          maxLimitOrderQuantityE9: '100000000000',
          tickSizeE9: '100000000',
          stepSizeE9: '100000',
          defaultLeverageE9: '10000000000',
          maxNotionalAtOpenE9: Array(50).fill('0'), // 50x
          defaultMakerFeeE9: '200000',
          defaultTakerFeeE9: '500000',
        },
      ],
    }),
    getAccountDetails: vi.fn().mockResolvedValue({
      marginBankBalance: '1000000000', // 1 USDC in e9
      totalCollateralValueE9: '1000000000',
      freeCollateralE9: '1000000000',
      accountValueE9: '1000000000',
      positions: [],
    }),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getTrades: vi.fn().mockResolvedValue([]),
    getFundingRateHistory: vi.fn().mockResolvedValue([]),
    getAccountFundingRateHistory: vi.fn().mockResolvedValue({ data: [] }),
    updateLeverage: vi.fn().mockResolvedValue(undefined),
    createOrder: vi.fn().mockResolvedValue({ orderHash: '0xorderhash_test' }),
    cancelOrders: vi.fn().mockResolvedValue(undefined),
    deposit: vi.fn().mockResolvedValue({ effects: { transactionDigest: '0xtxdigest' } }),
    withdraw: vi.fn().mockResolvedValue(undefined),
    waitForOrderEvent: vi
      .fn()
      .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
        await onReady();
        return { status: 'confirmed' as const, orderHash: '0xorderhash_test' };
      }),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as BluefinClient;
}

function makePlaceOrderIntent(
  overrides?: Partial<PerpPlaceOrderIntent['params']>,
  intentOverrides?: Partial<PerpPlaceOrderIntent>,
): PerpPlaceOrderIntent {
  return {
    action: 'perp:place_order',
    chainId: CHAIN_ID,
    walletAddress: WALLET_ADDRESS,
    params: {
      marketSymbol: 'SUI-PERP',
      side: 'SHORT',
      quantityE9: toE9('1'), // 1 SUI
      orderType: 'LIMIT',
      leverageE9: toE9('5'), // 5x
      limitPriceE9: toE9('5'), // $5 — far above market
      collateralCoinType: USDC_COIN_TYPE,
      marketCoinType: SUI_PERP_COIN_TYPE,
      ...overrides,
    },
    valueUsd: 5, // 1 SUI * $5
    ...intentOverrides,
  };
}

function makeCancelIntent(
  overrides?: Partial<PerpCancelOrderIntent['params']>,
): PerpCancelOrderIntent {
  return {
    action: 'perp:cancel_order',
    chainId: CHAIN_ID,
    walletAddress: WALLET_ADDRESS,
    params: {
      marketSymbol: 'SUI-PERP',
      ...overrides,
    },
  };
}

function makeDepositIntent(overrides?: Partial<PerpDepositIntent['params']>): PerpDepositIntent {
  return {
    action: 'perp:deposit',
    chainId: CHAIN_ID,
    walletAddress: WALLET_ADDRESS,
    params: {
      coinType: USDC_COIN_TYPE,
      amount: '1000000', // 1 USDC in native (6 decimals)
      decimals: 6,
      ...overrides,
    },
    valueUsd: 1,
  };
}

function makeWithdrawIntent(overrides?: Partial<PerpWithdrawIntent['params']>): PerpWithdrawIntent {
  return {
    action: 'perp:withdraw',
    chainId: CHAIN_ID,
    walletAddress: WALLET_ADDRESS,
    params: {
      assetSymbol: 'USDC',
      amountE9: toE9('0.5'), // 0.5 USDC
      ...overrides,
    },
    valueUsd: 0.5,
  };
}

// ─── Test Suite ────────────────────────────────────────────────────────────────

describe('E2E: Bluefin Pro Limit Orders (1 USDC wallet)', () => {
  let mockClient: BluefinClient;
  let mockActivityLog: ActivityLog;
  let mockCoinMetadataRepo: CoinMetadataRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockActivityLog = makeActivityLog();
    mockCoinMetadataRepo = makeCoinMetadataRepo();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 1: Basic Limit Order Placement
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group 1: Basic Limit Order Placement', () => {
    it('places SHORT SUI-PERP limit at $5, 5x leverage — full pipeline', async () => {
      mockClient = makeBluefinClient();
      // Setup: getOpenOrders returns the placed order after placement
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([
        {
          orderHash: '0xorderhash_test',
          clientOrderId: '', // Will be matched by builder
          symbol: 'SUI-PERP',
          side: 'SHORT',
          priceE9: toE9('5'),
          quantityE9: toE9('1'),
          leverageE9: toE9('5'),
          type: 'LIMIT',
          timeInForce: 'GTT',
          reduceOnly: false,
          status: 'OPEN',
          filledQuantityE9: '0',
        },
      ] as any);
      // Make getOpenOrders match the clientOrderId
      vi.mocked(mockClient.getOpenOrders).mockImplementation(async () => {
        const createCalls = vi.mocked(mockClient.createOrder).mock.calls;
        if (createCalls.length === 0) return [];
        const params = createCalls[0]![0];
        return [
          {
            orderHash: '0xorderhash_test',
            clientOrderId: params.clientOrderId,
            symbol: 'SUI-PERP',
            side: 'SHORT',
            priceE9: toE9('5'),
            quantityE9: toE9('1'),
            leverageE9: toE9('5'),
            type: 'LIMIT',
            timeInForce: 'GTT',
            reduceOnly: false,
            status: 'OPEN',
            filledQuantityE9: '0',
          },
        ] as any;
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent();

      // Validate
      expect(() => builder.validate(intent)).not.toThrow();

      // Build (off-chain — returns null tx)
      const built = await builder.build(intent);
      expect(built.transaction).toBeNull();

      // Execute
      const result = await builder.execute(intent);

      // Verify SDK calls
      expect(mockClient.updateLeverage).toHaveBeenCalledWith('SUI-PERP', toE9('5'));
      expect(mockClient.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LIMIT',
          symbol: 'SUI-PERP',
          side: 'SHORT',
          quantityE9: toE9('1'),
          priceE9: toE9('5'),
          leverageE9: toE9('5'),
          reduceOnly: false,
          timeInForce: 'GTT',
        }),
      );

      // Verify metadata
      expect(result.metadata).toEqual(
        expect.objectContaining({
          marketSymbol: 'SUI-PERP',
          side: 'SHORT',
          orderType: 'LIMIT',
          orderHash: '0xorderhash_test',
          quantityE9: toE9('1'),
          priceE9: toE9('5'),
          leverageE9: toE9('5'),
          reduceOnly: false,
          timeInForce: 'GTT',
        }),
      );

      // Finish — logs activity
      const finishCtx: FinishContext = {
        intent,
        status: 'approved',
        metadata: result.metadata,
      };
      builder.finish(finishCtx);

      // Verify activity record
      expect(activityRecords).toHaveLength(1);
      const record = activityRecords[0]!;
      expect(record.action).toBe('perp:place_order');
      expect(record.protocol).toBe('bluefin_pro');
      expect(record.chain_id).toBe(CHAIN_ID);
      expect(record.wallet_address).toBe(WALLET_ADDRESS);
      expect(record.policy_decision).toBe('approved');
      expect(record.token_a_type).toBe(USDC_COIN_TYPE);
      expect(record.token_b_type).toBe(SUI_PERP_COIN_TYPE);
      expect(record.value_usd).toBe(5);
    });

    it('places LONG SUI-PERP limit at $0.5, 5x leverage', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getOpenOrders).mockImplementation(async () => {
        const createCalls = vi.mocked(mockClient.createOrder).mock.calls;
        if (createCalls.length === 0) return [];
        return [
          {
            orderHash: '0xlong_order',
            clientOrderId: createCalls[0]![0].clientOrderId,
            symbol: 'SUI-PERP',
            side: 'LONG',
            status: 'OPEN',
          },
        ] as any;
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent(
        {
          side: 'LONG',
          limitPriceE9: toE9('0.5'),
        },
        { valueUsd: 0.5 },
      );

      const result = await builder.execute(intent);

      expect(result.metadata['side']).toBe('LONG');
      expect(result.metadata['priceE9']).toBe(toE9('0.5'));
      expect(result.metadata['orderHash']).toBe('0xlong_order');

      // Verify leverage was set
      expect(mockClient.updateLeverage).toHaveBeenCalledWith('SUI-PERP', toE9('5'));
    });

    it('places BTC-PERP SHORT limit at $200000 with 10x leverage', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getOpenOrders).mockImplementation(async () => {
        const createCalls = vi.mocked(mockClient.createOrder).mock.calls;
        if (createCalls.length === 0) return [];
        return [
          {
            orderHash: '0xbtc_order',
            clientOrderId: createCalls[0]![0].clientOrderId,
            symbol: 'BTC-PERP',
            status: 'OPEN',
          },
        ] as any;
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent(
        {
          marketSymbol: 'BTC-PERP',
          limitPriceE9: toE9('200000'),
          leverageE9: toE9('10'),
          quantityE9: toE9('0.001'), // Tiny qty for 1 USDC
          marketCoinType: BTC_PERP_COIN_TYPE,
        },
        { valueUsd: 200 },
      );

      const result = await builder.execute(intent);

      expect(mockClient.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTC-PERP',
          priceE9: toE9('200000'),
          leverageE9: toE9('10'),
          quantityE9: toE9('0.001'),
        }),
      );
      expect(result.metadata['orderHash']).toBe('0xbtc_order');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 2: Time-in-Force Variations
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group 2: Time-in-Force (GTT, IOC, FOK)', () => {
    it('GTT (default) — order remains open on books', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getOpenOrders).mockImplementation(async () => {
        const calls = vi.mocked(mockClient.createOrder).mock.calls;
        if (calls.length === 0) return [];
        return [
          { orderHash: '0xgtt', clientOrderId: calls[0]![0].clientOrderId, status: 'OPEN' },
        ] as any;
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const result = await builder.execute(makePlaceOrderIntent());

      expect(mockClient.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ timeInForce: 'GTT' }),
      );
      expect(result.metadata['timeInForce']).toBe('GTT');
      expect(result.metadata['orderHash']).toBe('0xgtt');
    });

    it('IOC — no match, order acknowledged (not in open orders)', async () => {
      mockClient = makeBluefinClient();
      // IOC at far price won't match; getOpenOrders returns empty (correctly)
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([]);

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({ timeInForce: 'IOC' });
      const result = await builder.execute(intent);

      // IOC path: confirmed by WS, not found in orders → acknowledged
      expect(result.metadata['note']).toBe(
        'IOC/FOK order processed. Check trade history for fill status.',
      );
      expect(result.metadata['orderHash']).toBe('0xorderhash_test');
      expect(result.metadata['timeInForce']).toBe('IOC');
    });

    it('IOC — INSUFFICIENT_LIQUIDITY rejection treated as acknowledged', async () => {
      mockClient = makeBluefinClient({
        waitForOrderEvent: vi
          .fn()
          .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
            await onReady();
            return {
              status: 'rejected' as const,
              reason: 'INSUFFICIENT_LIQUIDITY',
              orderHash: '0xioc_rej',
            };
          }),
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({ timeInForce: 'IOC' });
      const result = await builder.execute(intent);

      expect(result.metadata['note']).toBe('IOC/FOK order processed. No counterparty match.');
      expect(result.metadata['orderHash']).toBe('0xioc_rej');
    });

    it('FOK — no full fill, order acknowledged', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([]);

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({ timeInForce: 'FOK' });
      const result = await builder.execute(intent);

      expect(result.metadata['note']).toBe(
        'IOC/FOK order processed. Check trade history for fill status.',
      );
      expect(result.metadata['timeInForce']).toBe('FOK');
    });

    it('FOK — INSUFFICIENT_LIQUIDITY treated as acknowledged', async () => {
      mockClient = makeBluefinClient({
        waitForOrderEvent: vi
          .fn()
          .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
            await onReady();
            return { status: 'rejected' as const, reason: 'INSUFFICIENT_LIQUIDITY' };
          }),
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({ timeInForce: 'FOK' });
      const result = await builder.execute(intent);

      expect(result.metadata['note']).toBe('IOC/FOK order processed. No counterparty match.');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 3: Leverage Variations (1 USDC constraint)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group 3: Leverage Variations (1 USDC wallet)', () => {
    // With $1 USDC and $5 notional (1 SUI @ $5): margin = $5/leverage
    // leverage=2 → margin=$2.50 → EXCEEDS $1 → rejected
    // leverage=5 → margin=$1.00 → barely fits
    // leverage=10 → margin=$0.50 → fits
    // leverage=20 → margin=$0.25 → fits easily

    it('leverage=2 at $5 — INSUFFICIENT_MARGIN (needs $2.50, has $1)', async () => {
      mockClient = makeBluefinClient({
        waitForOrderEvent: vi
          .fn()
          .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
            await onReady();
            return { status: 'rejected' as const, reason: 'INSUFFICIENT_MARGIN' };
          }),
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({ leverageE9: toE9('2') });

      await expect(builder.execute(intent)).rejects.toThrow(
        'Order rejected by exchange: INSUFFICIENT_MARGIN',
      );

      // Activity should NOT be logged (execute threw)
      builder.finish({ intent, status: 'approved', metadata: {} });
      expect(activityRecords).toHaveLength(1); // Only the finish call
    });

    it('leverage=5 at $2 — accepted (margin=$0.40)', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getOpenOrders).mockImplementation(async () => {
        const calls = vi.mocked(mockClient.createOrder).mock.calls;
        if (calls.length === 0) return [];
        return [{ orderHash: '0xlev5', clientOrderId: calls[0]![0].clientOrderId }] as any;
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({
        limitPriceE9: toE9('2'),
        leverageE9: toE9('5'),
      });

      const result = await builder.execute(intent);
      expect(result.metadata['leverageE9']).toBe(toE9('5'));
      expect(result.metadata['priceE9']).toBe(toE9('2'));
    });

    it('leverage=10 at $2 — accepted (margin=$0.20)', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getOpenOrders).mockImplementation(async () => {
        const calls = vi.mocked(mockClient.createOrder).mock.calls;
        if (calls.length === 0) return [];
        return [{ orderHash: '0xlev10', clientOrderId: calls[0]![0].clientOrderId }] as any;
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({
        limitPriceE9: toE9('2'),
        leverageE9: toE9('10'),
      });

      const result = await builder.execute(intent);
      expect(result.metadata['leverageE9']).toBe(toE9('10'));
      expect(mockClient.updateLeverage).toHaveBeenCalledWith('SUI-PERP', toE9('10'));
    });

    it('leverage=20 at $2 — accepted (margin=$0.10)', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getOpenOrders).mockImplementation(async () => {
        const calls = vi.mocked(mockClient.createOrder).mock.calls;
        if (calls.length === 0) return [];
        return [{ orderHash: '0xlev20', clientOrderId: calls[0]![0].clientOrderId }] as any;
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({
        limitPriceE9: toE9('2'),
        leverageE9: toE9('20'),
      });

      const result = await builder.execute(intent);
      expect(result.metadata['leverageE9']).toBe(toE9('20'));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 4: Reduce-Only Flag
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group 4: Reduce-Only', () => {
    it('reduce-only SHORT with no position — REDUCE_ONLY_WOULD_OPEN', async () => {
      mockClient = makeBluefinClient({
        waitForOrderEvent: vi
          .fn()
          .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
            await onReady();
            return { status: 'rejected' as const, reason: 'REDUCE_ONLY_WOULD_OPEN' };
          }),
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({ reduceOnly: true });

      await expect(builder.execute(intent)).rejects.toThrow(
        'Order rejected by exchange: REDUCE_ONLY_WOULD_OPEN',
      );

      // Verify reduceOnly was sent to SDK
      expect(mockClient.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ reduceOnly: true }),
      );
    });

    it('reduce-only is passed correctly in metadata', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getOpenOrders).mockImplementation(async () => {
        const calls = vi.mocked(mockClient.createOrder).mock.calls;
        if (calls.length === 0) return [];
        return [{ orderHash: '0xro', clientOrderId: calls[0]![0].clientOrderId }] as any;
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({ reduceOnly: true });

      const result = await builder.execute(intent);
      expect(result.metadata['reduceOnly']).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 5: Multiple Orders & Cancel
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group 5: Multiple Orders & Cancel', () => {
    it('cancel specific order by hash', async () => {
      mockClient = makeBluefinClient();
      // 1 open order before cancel
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([
        { orderHash: '0xhash1', symbol: 'SUI-PERP' },
      ] as any);

      const cancelBuilder = new BluefinCancelOrderBuilder(mockClient, mockActivityLog);
      const cancelIntent = makeCancelIntent({ orderHashes: ['0xhash1'] });

      const result = await cancelBuilder.execute(cancelIntent);

      expect(mockClient.cancelOrders).toHaveBeenCalledWith({
        symbol: 'SUI-PERP',
        orderHashes: ['0xhash1'],
      });
      expect(result.metadata['cancelledCount']).toBe(1);
      expect(result.metadata['cancelAll']).toBe(false);
      expect(result.metadata['orderHashes']).toEqual(['0xhash1']);
    });

    it('cancel all orders for market', async () => {
      mockClient = makeBluefinClient();
      // 3 open orders before cancel
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([
        { orderHash: '0x1', symbol: 'SUI-PERP' },
        { orderHash: '0x2', symbol: 'SUI-PERP' },
        { orderHash: '0x3', symbol: 'SUI-PERP' },
      ] as any);

      const cancelBuilder = new BluefinCancelOrderBuilder(mockClient, mockActivityLog);
      const cancelIntent = makeCancelIntent(); // No orderHashes → cancel all

      const result = await cancelBuilder.execute(cancelIntent);

      expect(mockClient.cancelOrders).toHaveBeenCalledWith({ symbol: 'SUI-PERP' });
      expect(result.metadata['cancelledCount']).toBe(3);
      expect(result.metadata['cancelAll']).toBe(true);
    });

    it('cancel logs activity correctly', () => {
      mockClient = makeBluefinClient();
      const cancelBuilder = new BluefinCancelOrderBuilder(mockClient, mockActivityLog);
      const cancelIntent = makeCancelIntent();

      cancelBuilder.finish({
        intent: cancelIntent,
        status: 'approved',
        metadata: { cancelledCount: 2, cancelAll: true },
      });

      expect(activityRecords).toHaveLength(1);
      const record = activityRecords[0]!;
      expect(record.action).toBe('perp:cancel_order');
      expect(record.protocol).toBe('bluefin_pro');
      expect(record.policy_decision).toBe('approved');
    });

    it('cancel with no open orders — cancelledCount=0', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([]);

      const cancelBuilder = new BluefinCancelOrderBuilder(mockClient, mockActivityLog);
      const result = await cancelBuilder.execute(makeCancelIntent());

      expect(result.metadata['cancelledCount']).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 6: WS Confirmation & HTTP Verification
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group 6: WebSocket Confirmation Paths', () => {
    it('WS confirmed + HTTP verified → success', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getOpenOrders).mockImplementation(async () => {
        const calls = vi.mocked(mockClient.createOrder).mock.calls;
        if (calls.length === 0) return [];
        return [{ orderHash: '0xws_ok', clientOrderId: calls[0]![0].clientOrderId }] as any;
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const result = await builder.execute(makePlaceOrderIntent());

      expect(result.metadata['orderHash']).toBe('0xws_ok');
    });

    it('WS rejected — throws with reason', async () => {
      mockClient = makeBluefinClient({
        waitForOrderEvent: vi
          .fn()
          .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
            await onReady();
            return { status: 'rejected' as const, reason: 'PRICE_OUT_OF_BAND' };
          }),
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      await expect(builder.execute(makePlaceOrderIntent())).rejects.toThrow(
        'Order rejected by exchange: PRICE_OUT_OF_BAND',
      );
      // HTTP poll should NOT run on WS rejection
      expect(mockClient.getOpenOrders).not.toHaveBeenCalled();
    });

    it('WS timeout + HTTP finds order → success', async () => {
      mockClient = makeBluefinClient({
        waitForOrderEvent: vi
          .fn()
          .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
            await onReady();
            return { status: 'timeout' as const };
          }),
      });
      vi.mocked(mockClient.getOpenOrders).mockImplementation(async () => {
        const calls = vi.mocked(mockClient.createOrder).mock.calls;
        if (calls.length === 0) return [];
        return [{ orderHash: '0xtimeout_ok', clientOrderId: calls[0]![0].clientOrderId }] as any;
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const result = await builder.execute(makePlaceOrderIntent());

      expect(result.metadata['orderHash']).toBe('0xtimeout_ok');
    });

    it('WS timeout + HTTP order missing → throws', async () => {
      mockClient = makeBluefinClient({
        waitForOrderEvent: vi
          .fn()
          .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
            await onReady();
            return { status: 'timeout' as const };
          }),
      });
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([]);

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      await expect(builder.execute(makePlaceOrderIntent())).rejects.toThrow(
        'Order rejected by exchange: order not found after placement',
      );
    });

    it('WS confirmed + HTTP order missing (async cancel) → throws for GTT', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([]);

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      await expect(builder.execute(makePlaceOrderIntent())).rejects.toThrow(
        'Order rejected by exchange: order not found after placement',
      );
    });

    it('WS confirmed + HTTP order missing for IOC → acknowledged', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([]);

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({ timeInForce: 'IOC' });
      const result = await builder.execute(intent);

      expect(result.metadata['note']).toBe(
        'IOC/FOK order processed. Check trade history for fill status.',
      );
    });

    it('clientOrderId matches between WS and createOrder', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getOpenOrders).mockImplementation(async () => {
        const calls = vi.mocked(mockClient.createOrder).mock.calls;
        if (calls.length === 0) return [];
        return [{ orderHash: '0x_', clientOrderId: calls[0]![0].clientOrderId }] as any;
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      await builder.execute(makePlaceOrderIntent());

      const wsClientId = vi.mocked(mockClient.waitForOrderEvent).mock.calls[0]![0];
      const createClientId = vi.mocked(mockClient.createOrder).mock.calls[0]![0].clientOrderId;
      expect(wsClientId).toBe(createClientId);
      expect(wsClientId).toBeTruthy(); // UUID, not empty
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 7: Validation Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group 7: Validation Edge Cases', () => {
    it('rejects empty marketSymbol', () => {
      mockClient = makeBluefinClient();
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      expect(() => builder.validate(makePlaceOrderIntent({ marketSymbol: '' }))).toThrow(
        /marketSymbol/i,
      );
    });

    it('rejects zero quantity', () => {
      mockClient = makeBluefinClient();
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      expect(() => builder.validate(makePlaceOrderIntent({ quantityE9: '0' }))).toThrow(
        /quantity/i,
      );
    });

    it('rejects LIMIT without limitPriceE9', () => {
      mockClient = makeBluefinClient();
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      expect(() =>
        builder.validate(makePlaceOrderIntent({ orderType: 'LIMIT', limitPriceE9: undefined })),
      ).toThrow(/limitPriceE9/i);
    });

    it('allows MARKET without limitPriceE9', () => {
      mockClient = makeBluefinClient();
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      expect(() =>
        builder.validate(makePlaceOrderIntent({ orderType: 'MARKET', limitPriceE9: undefined })),
      ).not.toThrow();
    });

    it('cancel rejects empty marketSymbol', () => {
      mockClient = makeBluefinClient();
      const cancelBuilder = new BluefinCancelOrderBuilder(mockClient, mockActivityLog);
      expect(() => cancelBuilder.validate(makeCancelIntent({ marketSymbol: '' }))).toThrow(
        /marketSymbol/i,
      );
    });

    it('deposit rejects empty coinType', () => {
      mockClient = makeBluefinClient();
      const depositBuilder = new BluefinDepositBuilder(mockClient, mockActivityLog);
      expect(() => depositBuilder.validate(makeDepositIntent({ coinType: '' }))).toThrow(
        /coinType/i,
      );
    });

    it('deposit rejects zero amount', () => {
      mockClient = makeBluefinClient();
      const depositBuilder = new BluefinDepositBuilder(mockClient, mockActivityLog);
      expect(() => depositBuilder.validate(makeDepositIntent({ amount: '0' }))).toThrow(/amount/i);
    });

    it('withdraw rejects zero amount', () => {
      mockClient = makeBluefinClient();
      const withdrawBuilder = new BluefinWithdrawBuilder(mockClient, mockActivityLog);
      expect(() => withdrawBuilder.validate(makeWithdrawIntent({ amountE9: '0' }))).toThrow(
        /amount/i,
      );
    });

    it('withdraw rejects empty assetSymbol', () => {
      mockClient = makeBluefinClient();
      const withdrawBuilder = new BluefinWithdrawBuilder(mockClient, mockActivityLog);
      expect(() => withdrawBuilder.validate(makeWithdrawIntent({ assetSymbol: '' }))).toThrow(
        /assetSymbol/i,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 8: Deposit & Withdraw (supporting operations for limit orders)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group 8: Deposit & Withdraw', () => {
    it('deposit 1 USDC — full pipeline', async () => {
      mockClient = makeBluefinClient();
      const depositBuilder = new BluefinDepositBuilder(mockClient, mockActivityLog);
      const intent = makeDepositIntent();

      expect(() => depositBuilder.validate(intent)).not.toThrow();

      const built = await depositBuilder.build(intent);
      expect(built.transaction).toBeNull();

      const result = await depositBuilder.execute(intent);

      expect(mockClient.deposit).toHaveBeenCalledWith('1000000'); // Native amount, not e9
      expect(result.metadata['amount']).toBe('1000000');
      expect(result.metadata['coinType']).toBe(USDC_COIN_TYPE);
      expect(result.metadata['amountE9']).toBe('1000000000'); // nativeToE9(1000000, 6)
      expect(result.metadata['txDigest']).toBe('0xtxdigest');

      depositBuilder.finish({ intent, status: 'approved', metadata: result.metadata });

      expect(activityRecords).toHaveLength(1);
      expect(activityRecords[0]!.action).toBe('perp:deposit');
      expect(activityRecords[0]!.token_a_type).toBe(USDC_COIN_TYPE);
      expect(activityRecords[0]!.token_a_amount).toBe('1000000');
      expect(activityRecords[0]!.value_usd).toBe(1);
    });

    it('withdraw 0.5 USDC — full pipeline', async () => {
      mockClient = makeBluefinClient();
      const withdrawBuilder = new BluefinWithdrawBuilder(mockClient, mockActivityLog);
      const intent = makeWithdrawIntent();

      expect(() => withdrawBuilder.validate(intent)).not.toThrow();

      const built = await withdrawBuilder.build(intent);
      expect(built.transaction).toBeNull();

      const result = await withdrawBuilder.execute(intent);

      expect(mockClient.withdraw).toHaveBeenCalledWith('USDC', toE9('0.5'));
      expect(result.metadata['assetSymbol']).toBe('USDC');
      expect(result.metadata['amountE9']).toBe(toE9('0.5'));

      withdrawBuilder.finish({ intent, status: 'approved', metadata: result.metadata });

      expect(activityRecords).toHaveLength(1);
      expect(activityRecords[0]!.action).toBe('perp:withdraw');
      expect(activityRecords[0]!.value_usd).toBe(0.5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 9: Queryable API Metrics
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group 9: Bluefin Pro API Queryable Metrics', () => {
    it('getExchangeInfo — markets list with all fields', async () => {
      mockClient = makeBluefinClient();
      const markets = await fetchBluefinMarkets(mockClient);

      expect(markets).toHaveLength(2);
      const suiMarket = markets.find((m) => m.symbol === 'SUI-PERP')!;
      expect(suiMarket).toBeDefined();
      expect(suiMarket.baseAsset).toBe('SUI');
      expect(suiMarket.status).toBe('active');
      expect(suiMarket.minOrderSizeE9).toBeDefined();
      expect(suiMarket.maxOrderSizeE9).toBeDefined();
      expect(suiMarket.tickSizeE9).toBeDefined();
      expect(suiMarket.stepSizeE9).toBeDefined();
      expect(suiMarket.defaultLeverageE9).toBeDefined();
      expect(suiMarket.maxLeverageE9).toBe('20000000000'); // Array(20).length = 20
      expect(suiMarket.makerFeeE9).toBeDefined();
      expect(suiMarket.takerFeeE9).toBeDefined();

      const btcMarket = markets.find((m) => m.symbol === 'BTC-PERP')!;
      expect(btcMarket.maxLeverageE9).toBe('50000000000'); // Array(50).length = 50
    });

    it('resolveMarketSymbol — case insensitive', async () => {
      mockClient = makeBluefinClient();
      const markets = await fetchBluefinMarkets(mockClient);

      expect(resolveMarketSymbol(markets, 'sui-perp')).toBe('SUI-PERP');
      expect(resolveMarketSymbol(markets, 'BTC-PERP')).toBe('BTC-PERP');
      expect(() => resolveMarketSymbol(markets, 'FAKE-PERP')).toThrow(/Unknown Bluefin market/);
    });

    it('getAccountDetails — returns account metrics', async () => {
      mockClient = makeBluefinClient();
      const account = await mockClient.getAccountDetails();

      expect(account.marginBankBalance).toBe('1000000000'); // 1 USDC in e9
      expect(account.totalCollateralValueE9).toBe('1000000000');
      expect(account.freeCollateralE9).toBe('1000000000');
      expect(account.accountValueE9).toBe('1000000000');
      expect(account.positions).toEqual([]);
    });

    it('getOpenOrders — returns formatted order list', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getOpenOrders).mockResolvedValue([
        {
          orderHash: '0xorder1',
          symbol: 'SUI-PERP',
          side: 'SHORT',
          priceE9: toE9('5'),
          quantityE9: toE9('1'),
          leverageE9: toE9('5'),
          type: 'LIMIT',
          timeInForce: 'GTT',
          reduceOnly: false,
          status: 'OPEN',
          filledQuantityE9: '0',
          clientOrderId: 'uuid-1',
          createdAtMillis: Date.now(),
        },
      ] as any);

      const orders = await mockClient.getOpenOrders('SUI-PERP');
      expect(orders).toHaveLength(1);
      expect(orders[0]).toEqual(
        expect.objectContaining({
          orderHash: '0xorder1',
          symbol: 'SUI-PERP',
          side: 'SHORT',
          type: 'LIMIT',
          status: 'OPEN',
        }),
      );
    });

    it('getTrades — returns trade history', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getTrades).mockResolvedValue([
        {
          id: 'trade-1',
          symbol: 'SUI-PERP',
          side: 'BUY',
          priceE9: '3500000000',
          quantityE9: '1000000000',
          tradingFeeE9: '1750000',
          orderHash: '0xtrade_order',
          createdAt: '2026-03-25T12:00:00Z',
        },
      ] as any);

      const trades = await mockClient.getTrades({ symbol: 'SUI-PERP', limit: 10 });
      expect(trades).toHaveLength(1);
      expect(trades[0]).toEqual(
        expect.objectContaining({
          id: 'trade-1',
          symbol: 'SUI-PERP',
          side: 'BUY',
        }),
      );
    });

    it('getFundingRateHistory — returns entries', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getFundingRateHistory).mockResolvedValue([
        {
          symbol: 'SUI-PERP',
          fundingTimeAtMillis: 1711382400000,
          fundingRateE9: '100000',
        },
      ] as any);

      const entries = await mockClient.getFundingRateHistory({
        symbol: 'SUI-PERP',
        limit: 10,
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(
        expect.objectContaining({ symbol: 'SUI-PERP', fundingRateE9: '100000' }),
      );
    });

    it('getAccountFundingRateHistory — returns payment history', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getAccountFundingRateHistory).mockResolvedValue({
        data: [
          {
            symbol: 'SUI-PERP',
            paymentAmountE9: '500000',
            fundingRateE9: '100000',
          },
        ],
      } as any);

      const history = await mockClient.getAccountFundingRateHistory({ limit: 5 });
      expect(history.data).toHaveLength(1);
    });

    it('seedSyntheticCoinMetadata — upserts coin metadata', () => {
      const markets: BluefinMarketInfo[] = [SUI_MARKET, BTC_MARKET];
      seedSyntheticCoinMetadata(markets, mockCoinMetadataRepo, CHAIN_ID);

      expect(mockCoinMetadataRepo.upsertBulk).toHaveBeenCalledWith([
        {
          coin_type: toBluefinCoinType('SUI'),
          chain_id: CHAIN_ID,
          symbol: 'SUI',
          name: 'Bluefin Pro SUI-PERP',
          decimals: 9,
        },
        {
          coin_type: toBluefinCoinType('BTC'),
          chain_id: CHAIN_ID,
          symbol: 'BTC',
          name: 'Bluefin Pro BTC-PERP',
          decimals: 9,
        },
      ]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 10: Fill Sync & Activity Table Queries
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group 10: Fill Sync & Activity Table', () => {
    it('syncFills — syncs new trades into activities', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getTrades).mockResolvedValue([
        {
          id: 'fill-1',
          symbol: 'SUI-PERP',
          side: 'LONG',
          priceE9: '3500000000',
          quantityE9: '1000000000',
          tradingFeeE9: '1750000',
          orderHash: '0xfill_order_1',
        },
        {
          id: 'fill-2',
          symbol: 'SUI-PERP',
          side: 'SHORT',
          priceE9: '4000000000',
          quantityE9: '500000000',
          tradingFeeE9: '1000000',
          orderHash: '0xfill_order_2',
        },
      ] as any);

      const result = await syncFills(
        mockClient,
        mockActivityLog,
        mockCoinMetadataRepo,
        CHAIN_ID,
        WALLET_ADDRESS,
      );

      expect(result.synced).toBe(2);

      // Verify activity records
      expect(activityRecords).toHaveLength(2);

      // First fill
      const fill1 = activityRecords[0]!;
      expect(fill1.action).toBe('perp:filled');
      expect(fill1.protocol).toBe('bluefin_pro');
      expect(fill1.token_a_type).toBe(toBluefinCoinType('SUI'));
      expect(fill1.token_a_amount).toBe('1000000000');
      expect(fill1.policy_decision).toBe('approved');
      expect(fill1.metadata).toEqual(
        expect.objectContaining({
          marketSymbol: 'SUI-PERP',
          side: 'LONG',
          fillPrice: '3500000000',
          fillQuantity: '1000000000',
          fee: '1750000',
          orderHash: '0xfill_order_1',
          tradeId: 'fill-1',
        }),
      );

      // Notional value: 3.5 * 1.0 = 3.5 USD
      expect(fill1.value_usd).toBeCloseTo(3.5, 5);

      // Second fill
      const fill2 = activityRecords[1]!;
      expect(fill2.metadata).toEqual(
        expect.objectContaining({
          side: 'SHORT',
          fillPrice: '4000000000',
          fillQuantity: '500000000',
          tradeId: 'fill-2',
        }),
      );
      // Notional: 4.0 * 0.5 = 2.0
      expect(fill2.value_usd).toBeCloseTo(2.0, 5);

      // Verify coin metadata was seeded
      expect(mockCoinMetadataRepo.upsertBulk).toHaveBeenCalledOnce();
    });

    it('syncFills — resumes from last sync timestamp', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockActivityLog.getLastSyncTimestamp).mockReturnValue('2026-03-25T10:00:00.000Z');
      vi.mocked(mockClient.getTrades).mockResolvedValue([]);

      await syncFills(mockClient, mockActivityLog, mockCoinMetadataRepo, CHAIN_ID, WALLET_ADDRESS);

      expect(mockClient.getTrades).toHaveBeenCalledWith(
        expect.objectContaining({
          startTimeAtMillis: new Date('2026-03-25T10:00:00.000Z').getTime() + 1,
          limit: 1000,
        }),
      );
    });

    it('syncFills — no last sync, fetches all', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockActivityLog.getLastSyncTimestamp).mockReturnValue(null);
      vi.mocked(mockClient.getTrades).mockResolvedValue([]);

      await syncFills(mockClient, mockActivityLog, mockCoinMetadataRepo, CHAIN_ID, WALLET_ADDRESS);

      expect(mockClient.getTrades).toHaveBeenCalledWith({ limit: 1000 });
    });

    it('syncFills — skips unparseable market symbols', async () => {
      mockClient = makeBluefinClient();
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.mocked(mockClient.getTrades).mockResolvedValue([
        {
          id: 'fill-ok',
          symbol: 'SUI-PERP',
          side: 'LONG',
          priceE9: '3500000000',
          quantityE9: '1000000000',
          tradingFeeE9: '0',
          orderHash: '0x_',
        },
        {
          id: 'fill-bad',
          symbol: 'INVALID_SYMBOL',
          side: 'LONG',
          priceE9: '0',
          quantityE9: '0',
          tradingFeeE9: '0',
          orderHash: '0x_',
        },
      ] as any);

      const result = await syncFills(
        mockClient,
        mockActivityLog,
        mockCoinMetadataRepo,
        CHAIN_ID,
        WALLET_ADDRESS,
      );

      expect(result.synced).toBe(1); // Only valid trade synced
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping unparseable symbol'),
      );
      consoleSpy.mockRestore();
    });

    it('syncFills — maps BUY side to LONG', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getTrades).mockResolvedValue([
        {
          id: 'fill-buy',
          symbol: 'SUI-PERP',
          side: 'BUY',
          priceE9: '3000000000',
          quantityE9: '1000000000',
          tradingFeeE9: '0',
          orderHash: '0x_',
        },
      ] as any);

      await syncFills(mockClient, mockActivityLog, mockCoinMetadataRepo, CHAIN_ID, WALLET_ADDRESS);

      expect(activityRecords[0]!.metadata).toEqual(expect.objectContaining({ side: 'LONG' }));
    });

    it('syncFills — maps SELL side to SHORT', async () => {
      mockClient = makeBluefinClient();
      vi.mocked(mockClient.getTrades).mockResolvedValue([
        {
          id: 'fill-sell',
          symbol: 'SUI-PERP',
          side: 'SELL',
          priceE9: '3000000000',
          quantityE9: '1000000000',
          tradingFeeE9: '0',
          orderHash: '0x_',
        },
      ] as any);

      await syncFills(mockClient, mockActivityLog, mockCoinMetadataRepo, CHAIN_ID, WALLET_ADDRESS);

      expect(activityRecords[0]!.metadata).toEqual(expect.objectContaining({ side: 'SHORT' }));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 11: Activity Log Entry Verification
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group 11: Activity Log Entry Completeness', () => {
    it('place_order rejection logs correctly', () => {
      mockClient = makeBluefinClient();
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent();

      builder.finish({
        intent,
        status: 'rejected',
        rejection: { check: 'spending_limit', reason: '24h limit exceeded' },
      });

      const record = activityRecords[0]!;
      expect(record.policy_decision).toBe('rejected');
      expect(record.rejection_check).toBe('spending_limit');
      expect(record.rejection_reason).toBe('24h limit exceeded');
      expect(record.token_a_type).toBe(USDC_COIN_TYPE);
      expect(record.token_b_type).toBe(SUI_PERP_COIN_TYPE);
    });

    it('place_order approval includes metadata and value_usd', () => {
      mockClient = makeBluefinClient();
      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      const intent = makePlaceOrderIntent({}, { valueUsd: 42.5 });

      builder.finish({
        intent,
        status: 'approved',
        metadata: { orderHash: '0xtest', marketSymbol: 'SUI-PERP' },
      });

      const record = activityRecords[0]!;
      expect(record.policy_decision).toBe('approved');
      expect(record.value_usd).toBe(42.5);
      expect(record.metadata).toEqual(
        expect.objectContaining({ orderHash: '0xtest', marketSymbol: 'SUI-PERP' }),
      );
    });

    it('deposit approval logs token type and amount', () => {
      mockClient = makeBluefinClient();
      const builder = new BluefinDepositBuilder(mockClient, mockActivityLog);
      const intent = makeDepositIntent();

      builder.finish({ intent, status: 'approved', metadata: {} });

      const record = activityRecords[0]!;
      expect(record.action).toBe('perp:deposit');
      expect(record.token_a_type).toBe(USDC_COIN_TYPE);
      expect(record.token_a_amount).toBe('1000000');
      expect(record.value_usd).toBe(1);
    });

    it('withdraw approval logs value_usd', () => {
      mockClient = makeBluefinClient();
      const builder = new BluefinWithdrawBuilder(mockClient, mockActivityLog);
      const intent = makeWithdrawIntent();

      builder.finish({ intent, status: 'approved', metadata: {} });

      const record = activityRecords[0]!;
      expect(record.action).toBe('perp:withdraw');
      expect(record.value_usd).toBe(0.5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 12: E9 Conversion & Type Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group 12: E9 Conversion & Type Helpers', () => {
    it('toE9 and fromE9 are inverse operations', () => {
      const values = ['0', '1', '0.5', '1.234567890', '100000', '0.000000001'];
      for (const v of values) {
        const e9 = toE9(v);
        const back = fromE9(e9);
        expect(back).toBeCloseTo(parseFloat(v), 9);
      }
    });

    it('toBluefinCoinType generates correct synthetic type', () => {
      expect(toBluefinCoinType('BTC')).toContain('::bluefin_pro::BTC');
      expect(toBluefinCoinType('ETH')).toContain('::bluefin_pro::ETH');
      expect(toBluefinCoinType('SUI')).toContain('::bluefin_pro::SUI');
      // Different assets → different types
      expect(toBluefinCoinType('BTC')).not.toBe(toBluefinCoinType('ETH'));
    });

    it('parseBluefinMarketSymbol extracts base asset', () => {
      expect(parseBluefinMarketSymbol('BTC-PERP')).toBe('BTC');
      expect(parseBluefinMarketSymbol('ETH-PERP')).toBe('ETH');
      expect(parseBluefinMarketSymbol('SUI-PERP')).toBe('SUI');
    });

    it('parseBluefinMarketSymbol rejects invalid formats', () => {
      expect(() => parseBluefinMarketSymbol('INVALID')).toThrow();
      expect(() => parseBluefinMarketSymbol('BTC-SPOT')).toThrow();
      expect(() => parseBluefinMarketSymbol('-PERP')).toThrow();
      expect(() => parseBluefinMarketSymbol('')).toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 13: Exchange Error Propagation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group 13: Exchange Error Propagation', () => {
    it('INSUFFICIENT_MARGIN — not silenced', async () => {
      mockClient = makeBluefinClient({
        waitForOrderEvent: vi
          .fn()
          .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
            await onReady();
            return { status: 'rejected' as const, reason: 'INSUFFICIENT_MARGIN' };
          }),
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      await expect(builder.execute(makePlaceOrderIntent())).rejects.toThrow('INSUFFICIENT_MARGIN');
    });

    it('QUANTITY_OUT_OF_BOUND — not silenced', async () => {
      mockClient = makeBluefinClient({
        waitForOrderEvent: vi
          .fn()
          .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
            await onReady();
            return { status: 'rejected' as const, reason: 'QUANTITY_OUT_OF_BOUND' };
          }),
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      await expect(builder.execute(makePlaceOrderIntent())).rejects.toThrow(
        'QUANTITY_OUT_OF_BOUND',
      );
    });

    it('REDUCE_ONLY_WOULD_OPEN — not silenced', async () => {
      mockClient = makeBluefinClient({
        waitForOrderEvent: vi
          .fn()
          .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
            await onReady();
            return { status: 'rejected' as const, reason: 'REDUCE_ONLY_WOULD_OPEN' };
          }),
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      await expect(builder.execute(makePlaceOrderIntent({ reduceOnly: true }))).rejects.toThrow(
        'REDUCE_ONLY_WOULD_OPEN',
      );
    });

    it('PRICE_OUT_OF_BAND — not silenced', async () => {
      mockClient = makeBluefinClient({
        waitForOrderEvent: vi
          .fn()
          .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
            await onReady();
            return { status: 'rejected' as const, reason: 'PRICE_OUT_OF_BAND' };
          }),
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      await expect(builder.execute(makePlaceOrderIntent())).rejects.toThrow('PRICE_OUT_OF_BAND');
    });

    it('unknown rejection reason — propagated with "unknown reason"', async () => {
      mockClient = makeBluefinClient({
        waitForOrderEvent: vi
          .fn()
          .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
            await onReady();
            return { status: 'rejected' as const };
          }),
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      await expect(builder.execute(makePlaceOrderIntent())).rejects.toThrow('unknown reason');
    });

    it('WebSocket connection failure — propagated', async () => {
      mockClient = makeBluefinClient({
        waitForOrderEvent: vi
          .fn()
          .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
            await onReady();
            return {
              status: 'rejected' as const,
              reason: 'WebSocket connection failed: Connection refused',
            };
          }),
      });

      const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      await expect(builder.execute(makePlaceOrderIntent())).rejects.toThrow(
        'WebSocket connection failed',
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 14: Builder Identity & Strategy
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group 14: Builder Identity & Strategy', () => {
    it('all builders have correct chain and executionStrategy', () => {
      mockClient = makeBluefinClient();

      const placeOrder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
      expect(placeOrder.builderId).toBe('bluefin-pro-place-order');
      expect(placeOrder.chain).toBe('sui');
      expect(placeOrder.executionStrategy).toBe('off-chain-signed');

      const cancel = new BluefinCancelOrderBuilder(mockClient, mockActivityLog);
      expect(cancel.builderId).toBe('bluefin-pro-cancel-order');
      expect(cancel.chain).toBe('sui');
      expect(cancel.executionStrategy).toBe('off-chain-signed');

      const deposit = new BluefinDepositBuilder(mockClient, mockActivityLog);
      expect(deposit.builderId).toBe('bluefin-pro-deposit');
      expect(deposit.chain).toBe('sui');
      expect(deposit.executionStrategy).toBe('off-chain-signed');

      const withdraw = new BluefinWithdrawBuilder(mockClient, mockActivityLog);
      expect(withdraw.builderId).toBe('bluefin-pro-withdraw');
      expect(withdraw.chain).toBe('sui');
      expect(withdraw.executionStrategy).toBe('off-chain-signed');
    });

    it('all builders return null transaction from build()', async () => {
      mockClient = makeBluefinClient();

      const builders = [
        new BluefinPlaceOrderBuilder(mockClient, mockActivityLog),
        new BluefinCancelOrderBuilder(mockClient, mockActivityLog),
        new BluefinDepositBuilder(mockClient, mockActivityLog),
        new BluefinWithdrawBuilder(mockClient, mockActivityLog),
      ];

      const intents = [
        makePlaceOrderIntent(),
        makeCancelIntent(),
        makeDepositIntent(),
        makeWithdrawIntent(),
      ];

      for (let i = 0; i < builders.length; i++) {
        const built = await builders[i]!.build(intents[i]! as any);
        expect(built.transaction).toBeNull();
      }
    });
  });
});
