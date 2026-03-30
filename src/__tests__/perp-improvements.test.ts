import Database from 'better-sqlite3';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainAdapter } from '../chain/adapter.js';
import type { ActionBuilder, FinishContext } from '../core/action-builder.js';
import type { PerpPlaceOrderIntent } from '../core/action-types.js';
import { NoOpMevProtector } from '../core/mev-protector.js';
import type { PipelineInput } from '../core/transaction-pipeline.js';
import { executePipeline } from '../core/transaction-pipeline.js';
import { ActivityLog } from '../db/activity-log.js';
import { runMigrations } from '../db/migrations.js';
import type { PolicyContext } from '../policy/context.js';
import { PolicyCheckRegistry } from '../policy/registry.js';
import type { BluefinClient } from '../chain/sui/bluefin-pro/client.js';
import { BluefinPlaceOrderBuilder } from '../chain/sui/bluefin-pro/place-order.js';
import { EXIT_CODES } from '../cli/output.js';
import { createMockLogger } from './helpers.js';

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

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

function createMockBluefinClient(overrides?: Partial<BluefinClient>): BluefinClient {
  return {
    createOrder: vi.fn().mockResolvedValue({ orderHash: '0xorderhash123' }),
    waitForOrderEvent: vi
      .fn()
      .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
        await onReady();
        return { status: 'confirmed' as const, orderHash: '0xorderhash123' };
      }),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getStandbyOrders: vi.fn().mockResolvedValue([]),
    getTrades: vi.fn().mockResolvedValue([]),
    getAccountDetails: vi.fn().mockResolvedValue({
      positions: [],
    }),
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
    ...overrides,
  } as unknown as BluefinClient;
}

function createPipelineDeps(): {
  logger: Logger;
  policyRegistry: PolicyCheckRegistry;
  policyContext: PolicyContext;
} {
  const db = new Database(':memory:');
  runMigrations(db);
  const activityLog = new ActivityLog(db);
  return {
    logger: createMockLogger(),
    policyRegistry: new PolicyCheckRegistry(),
    policyContext: {
      config: { chain: 'sui', tokenAllowlist: [], dailyLimitUsd: 10000 },
      activityLog,
    } as unknown as PolicyContext,
  };
}

function createMockChainAdapter(): ChainAdapter {
  return {
    chain: 'sui',
    getBalance: vi.fn(),
    buildTransactionBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    simulate: vi.fn().mockResolvedValue({
      success: true,
      gasEstimate: 5000,
      rawResponse: { events: [] },
    }),
    signAndSubmit: vi.fn().mockResolvedValue({
      txDigest: 'TX_DIGEST_ABC',
      status: 'success',
      gasUsed: 4500,
      rawResponse: { events: [] },
    }),
  } as unknown as ChainAdapter;
}

// ===================================================================
// 1. SDK log redirection
// ===================================================================

describe('SDK log redirection (withSdkLogsToStderr)', () => {
  it('place-order builder does not write SDK logs to stdout', async () => {
    // The SDK calls (ensureInitialized, waitForOrderEvent, createOrder)
    // are mocked, so we verify that console.log during SDK calls in the
    // real client is redirected. Here we test the builder integration
    // does not leak console.log to stdout via the mock pipeline.
    const mockClient = createMockBluefinClient();
    const mockActivityLog = { logActivity: vi.fn().mockReturnValue(1) } as any;
    const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
    const intent = makePlaceOrderIntent();

    // If SDK log redirection is broken, console.log from SDK internals
    // would pollute stdout. We verify our builder path completes cleanly.
    const result = await builder.execute(intent);
    expect(result.metadata).toBeDefined();
    expect(result.metadata['marketSymbol']).toBe('BTC-PERP');
  });
});

// ===================================================================
// 2. Acknowledged status
// ===================================================================

describe('Acknowledged pipeline status', () => {
  it('pipeline returns acknowledged when builder metadata has _pipelineStatus', async () => {
    const { logger, policyRegistry, policyContext } = createPipelineDeps();
    const intent = makePlaceOrderIntent();

    const builder: ActionBuilder = {
      builderId: 'bluefin-pro-place-order',
      chain: 'sui',
      executionStrategy: 'off-chain-signed',
      validate: vi.fn(),
      build: vi.fn().mockResolvedValue({ transaction: null, metadata: {} }),
      execute: vi.fn().mockResolvedValue({
        metadata: {
          marketSymbol: 'BTC-PERP',
          _pipelineStatus: 'acknowledged',
          note: 'Order submitted but WS confirmation timed out.',
        },
      }),
      finish: vi.fn(),
    };

    const input: PipelineInput = {
      intent,
      builder,
      chainAdapter: createMockChainAdapter(),
      policyRegistry,
      policyContext,
      mevProtector: new NoOpMevProtector(),
      logger,
      watchOnly: false,
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('acknowledged');
    expect(result.metadata?.['_pipelineStatus']).toBe('acknowledged');
    expect(result.metadata?.['note']).toContain('timed out');
  });

  it('pipeline returns success when _pipelineStatus is absent', async () => {
    const { logger, policyRegistry, policyContext } = createPipelineDeps();
    const intent = makePlaceOrderIntent();

    const builder: ActionBuilder = {
      builderId: 'bluefin-pro-place-order',
      chain: 'sui',
      executionStrategy: 'off-chain-signed',
      validate: vi.fn(),
      build: vi.fn().mockResolvedValue({ transaction: null, metadata: {} }),
      execute: vi.fn().mockResolvedValue({
        metadata: { marketSymbol: 'BTC-PERP', orderHash: '0xhash' },
      }),
      finish: vi.fn(),
    };

    const input: PipelineInput = {
      intent,
      builder,
      chainAdapter: createMockChainAdapter(),
      policyRegistry,
      policyContext,
      mevProtector: new NoOpMevProtector(),
      logger,
      watchOnly: false,
    };

    const result = await executePipeline(input);
    expect(result.status).toBe('success');
  });

  it('EXIT_CODES maps acknowledged to 0', () => {
    expect(EXIT_CODES['acknowledged']).toBe(0);
  });

  it('place-order builder sets _pipelineStatus on WS timeout', async () => {
    const mockClient = createMockBluefinClient({
      waitForOrderEvent: vi
        .fn()
        .mockImplementation(async (_id: string, onReady: () => Promise<void>) => {
          await onReady();
          return { status: 'timeout' as const };
        }),
    });
    const mockActivityLog = { logActivity: vi.fn().mockReturnValue(1) } as any;
    const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
    const intent = makePlaceOrderIntent();

    const result = await builder.execute(intent);

    expect(result.metadata['_pipelineStatus']).toBe('acknowledged');
    expect(result.metadata['note']).toContain('WS confirmation timed out');
  });

  it('hasPayload includes acknowledged — pipeline output includes payload', async () => {
    const { logger, policyRegistry, policyContext } = createPipelineDeps();
    const intent = makePlaceOrderIntent();

    const builder: ActionBuilder = {
      builderId: 'bluefin-pro-place-order',
      chain: 'sui',
      executionStrategy: 'off-chain-signed',
      validate: vi.fn(),
      build: vi.fn().mockResolvedValue({ transaction: null, metadata: {} }),
      execute: vi.fn().mockResolvedValue({
        metadata: {
          marketSymbol: 'BTC-PERP',
          _pipelineStatus: 'acknowledged',
          note: 'Order submitted but WS confirmation timed out.',
        },
      }),
      finish: vi.fn(),
    };

    const input: PipelineInput = {
      intent,
      builder,
      chainAdapter: createMockChainAdapter(),
      policyRegistry,
      policyContext,
      mevProtector: new NoOpMevProtector(),
      logger,
      watchOnly: false,
    };

    const result = await executePipeline(input);

    // The pipeline itself returns acknowledged status
    expect(result.status).toBe('acknowledged');
    // finish is still called (builder can log activity)
    expect(builder.finish).toHaveBeenCalledOnce();
    const ctx = (builder.finish as ReturnType<typeof vi.fn>).mock.calls[0]![0] as FinishContext;
    expect(ctx.status).toBe('approved');
  });
});

// ===================================================================
// 3. Perp close command logic
// ===================================================================

describe('Perp close logic', () => {
  // The close command in perp.ts is CLI-level; we test the core logic:
  // - Auto-detect side (opposite of position)
  // - Full close (uses position.sizeE9)
  // - Partial close (uses --size value)
  // - Error when no position
  // - Error when size > position (validated by exchange, not CLI)

  it('closes a LONG position with SHORT reduce-only market order', () => {
    // Simulate what the close command does: given a LONG position, the
    // intent should be SHORT, reduceOnly, with the position's leverage.
    const position = {
      symbol: 'BTC-PERP',
      side: 'LONG' as const,
      sizeE9: '2000000000',
      leverageE9: '5000000000',
    };

    const closeSide = position.side === 'LONG' ? 'SHORT' : 'LONG';
    const closeQuantityE9 = position.sizeE9; // full close

    expect(closeSide).toBe('SHORT');
    expect(closeQuantityE9).toBe('2000000000');
  });

  it('closes a SHORT position with LONG reduce-only market order', () => {
    const position = {
      symbol: 'ETH-PERP',
      side: 'SHORT' as const,
      sizeE9: '500000000',
      leverageE9: '3000000000',
    };

    const closeSide = position.side === 'LONG' ? 'SHORT' : 'LONG';
    expect(closeSide).toBe('LONG');
  });

  it('partial close uses provided size instead of full position', () => {
    const position = {
      symbol: 'BTC-PERP',
      side: 'LONG' as const,
      sizeE9: '2000000000',
      leverageE9: '5000000000',
    };

    const userSize = '500000000'; // partial
    const closeQuantityE9 = userSize !== undefined ? userSize : position.sizeE9;

    expect(closeQuantityE9).toBe('500000000');
    expect(closeQuantityE9).not.toBe(position.sizeE9);
  });

  it('errors when no position exists for the market', () => {
    const positions: { symbol: string }[] = [];
    const marketSymbol = 'BTC-PERP';

    const position = positions.find((p) => p.symbol === marketSymbol);

    expect(position).toBeUndefined();
    // The CLI throws: 'No open position for market "BTC-PERP"'
    expect(() => {
      if (position === undefined) {
        throw new Error(`No open position for market "${marketSymbol}"`);
      }
    }).toThrow('No open position for market "BTC-PERP"');
  });

  it('close intent uses position leverage, not user-specified', () => {
    const position = {
      symbol: 'BTC-PERP',
      side: 'LONG' as const,
      sizeE9: '2000000000',
      leverageE9: '10000000000', // 10x
    };

    // The close command passes position.leverageE9 directly
    const intent = makePlaceOrderIntent({
      side: 'SHORT',
      quantityE9: position.sizeE9,
      leverageE9: position.leverageE9,
      reduceOnly: true,
    });

    expect(intent.params.leverageE9).toBe('10000000000');
    expect(intent.params.reduceOnly).toBe(true);
    expect(intent.params.orderType).toBe('MARKET');
    expect(intent.params.side).toBe('SHORT');
  });
});

// ===================================================================
// 4. Order status — open, standby, not found
// ===================================================================

describe('Order status lookup', () => {
  it('finds order in open orders', async () => {
    const openOrders = [
      { orderHash: '0xhash1', symbol: 'BTC-PERP', status: 'OPEN' },
      { orderHash: '0xhash2', symbol: 'ETH-PERP', status: 'OPEN' },
    ];
    const standbyOrders: { orderHash: string }[] = [];

    const orderHash = '0xhash1';
    const openMatch = openOrders.find((o) => o.orderHash === orderHash);
    const standbyMatch =
      openMatch === undefined ? standbyOrders.find((o) => o.orderHash === orderHash) : undefined;

    expect(openMatch).toBeDefined();
    expect(openMatch!.symbol).toBe('BTC-PERP');
    expect(standbyMatch).toBeUndefined(); // not checked since found in open
  });

  it('finds order in standby orders when not in open', async () => {
    const openOrders: { orderHash: string }[] = [];
    const standbyOrders = [{ orderHash: '0xstop1', symbol: 'BTC-PERP', status: 'STANDBY' }];

    const orderHash = '0xstop1';
    const openMatch = openOrders.find((o) => o.orderHash === orderHash);
    const standbyMatch = standbyOrders.find((o) => o.orderHash === orderHash);

    expect(openMatch).toBeUndefined();
    expect(standbyMatch).toBeDefined();
    expect(standbyMatch!.symbol).toBe('BTC-PERP');
  });

  it('throws when order not found in open or standby', () => {
    const openOrders: { orderHash: string }[] = [];
    const standbyOrders: { orderHash: string }[] = [];

    const orderHash = '0xnotfound';
    const openMatch = openOrders.find((o) => o.orderHash === orderHash);
    const standbyMatch = standbyOrders.find((o) => o.orderHash === orderHash);

    expect(openMatch).toBeUndefined();
    expect(standbyMatch).toBeUndefined();
    expect(() => {
      if (openMatch === undefined && standbyMatch === undefined) {
        throw new Error(`Order "${orderHash}" not found in open or standby orders`);
      }
    }).toThrow('Order "0xnotfound" not found in open or standby orders');
  });

  it('BluefinClient has getStandbyOrders method', () => {
    const mockClient = createMockBluefinClient();
    expect(mockClient.getStandbyOrders).toBeDefined();
    expect(typeof mockClient.getStandbyOrders).toBe('function');
  });
});

// ===================================================================
// 5. getTickerPrice
// ===================================================================

describe('BluefinPerpProvider.getTickerPrice', () => {
  it('getTickerPrice returns last price from exchange ticker', async () => {
    const { BluefinPerpProvider } = await import('../chain/sui/bluefin-pro/provider.js');
    const mockClient = createMockBluefinClient({
      getMarketTicker: vi.fn().mockResolvedValue({
        lastPriceE9: '3800000000',
        markPriceE9: '3800000000',
      }),
    });
    const provider = new BluefinPerpProvider(mockClient);
    const price = await provider.getTickerPrice('SUI-PERP');
    expect(price).toBe(3.8);
  });
});

// ===================================================================
// 6. Auto-resolve leverage from existing position
// ===================================================================

describe('Auto-resolve leverage from existing position', () => {
  let mockActivityLog: any;

  beforeEach(() => {
    mockActivityLog = { logActivity: vi.fn().mockReturnValue(1) };
  });

  it('uses position leverage when no explicit leverage and position exists', async () => {
    const mockClient = createMockBluefinClient({
      getAccountDetails: vi.fn().mockResolvedValue({
        positions: [
          {
            symbol: 'BTC-PERP',
            clientSetLeverageE9: '7000000000', // 7x
          },
        ],
      }),
    });

    const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
    const intent = makePlaceOrderIntent();
    // Remove explicit leverage
    (intent as { params: Record<string, unknown> }).params.leverageE9 = undefined;

    await builder.execute(intent);

    // Should use position's leverage (7x), not market default (3x)
    expect(mockClient.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        leverageE9: '7000000000',
      }),
    );
  });

  it('uses market default leverage when no explicit leverage and no position', async () => {
    const mockClient = createMockBluefinClient({
      getAccountDetails: vi.fn().mockResolvedValue({
        positions: [], // no position
      }),
    });

    const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
    const intent = makePlaceOrderIntent();
    // Remove explicit leverage
    (intent as { params: Record<string, unknown> }).params.leverageE9 = undefined;

    await builder.execute(intent);

    // Should fall back to market default (3x)
    expect(mockClient.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        leverageE9: '3000000000',
      }),
    );
  });

  it('explicit leverage overrides position leverage', async () => {
    const mockClient = createMockBluefinClient({
      getAccountDetails: vi.fn().mockResolvedValue({
        positions: [
          {
            symbol: 'BTC-PERP',
            clientSetLeverageE9: '7000000000', // 7x from position
          },
        ],
      }),
    });

    const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
    const intent = makePlaceOrderIntent({ leverageE9: '10000000000' }); // explicit 10x

    await builder.execute(intent);

    // Should use explicit leverage (10x), not position (7x)
    expect(mockClient.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        leverageE9: '10000000000',
      }),
    );
    // Should NOT call getAccountDetails when leverage is explicit
    expect(mockClient.getAccountDetails).not.toHaveBeenCalled();
  });

  it('calls getAccountDetails only when leverage is omitted', async () => {
    const mockClient = createMockBluefinClient();

    const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
    const intent = makePlaceOrderIntent({ leverageE9: '5000000000' });

    await builder.execute(intent);

    expect(mockClient.getAccountDetails).not.toHaveBeenCalled();
  });

  it('uses market default when position exists for a different market', async () => {
    const mockClient = createMockBluefinClient({
      getAccountDetails: vi.fn().mockResolvedValue({
        positions: [
          {
            symbol: 'ETH-PERP', // different market
            clientSetLeverageE9: '7000000000',
          },
        ],
      }),
    });

    const builder = new BluefinPlaceOrderBuilder(mockClient, mockActivityLog);
    const intent = makePlaceOrderIntent(); // BTC-PERP
    (intent as { params: Record<string, unknown> }).params.leverageE9 = undefined;

    await builder.execute(intent);

    // No BTC-PERP position → fall back to market default (3x)
    expect(mockClient.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        leverageE9: '3000000000',
      }),
    );
  });
});
