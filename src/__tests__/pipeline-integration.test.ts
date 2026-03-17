import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from 'pino';
import type Database from 'better-sqlite3';
import type { ChainAdapter } from '../chain/adapter.js';
import type { ActionBuilder, BuiltTransaction } from '../core/action-builder.js';
import type { ActionPreview, SwapIntent } from '../core/action-types.js';
import type { Signer, SimulationResult, TxResult } from '../types/result.js';
import type { ChainConfig } from '../types/config.js';
import type { PolicyContext } from '../policy/context.js';
import { PolicyCheckRegistry } from '../policy/registry.js';
import { TokenAllowlistCheck } from '../policy/checks/token-allowlist.js';
import { SpendingLimitCheck } from '../policy/checks/spending-limit.js';
import { TradeLog } from '../db/trade-log.js';
import { openMemoryDatabase } from '../db/connection.js';
import { NoOpMevProtector } from '../core/mev-protector.js';
import { executePipeline } from '../core/transaction-pipeline.js';
import { createMockOracle, insertTestWallet } from './helpers.js';

// --- Shared fixtures ---

const chainConfig: ChainConfig = {
  rpc: 'https://test.sui.io',
  allowlist: { tokens: ['SUI', 'USDC'] },
  limits: { max_single_trade: 1000, max_24h_volume: 5000 },
};

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createSwapIntent(overrides?: Partial<SwapIntent['params']>): SwapIntent {
  return {
    chain: 'sui',
    action: 'swap',
    walletAddress: '0xabc',
    params: {
      coinTypeIn: '0x2::sui::SUI',
      coinTypeOut: '0xdba3::usdc::USDC',
      amountIn: '100000000',
      slippageBps: 100,
      ...overrides,
    },
  };
}

const mockPreview: ActionPreview = {
  description: 'Swap 100 SUI -> USDC',
  expectedOutput: '98120000',
  provider: '7k',
  priceImpact: 0.01,
  buildData: { tx: 'mock-build-data' },
};

const mockBuiltTx: BuiltTransaction = {
  transaction: { kind: 'mock-tx' },
  metadata: { source: 'test' },
};

function createMockBuilder(): ActionBuilder {
  return {
    builderId: 'test-builder',
    chain: 'sui',
    validate: vi.fn(),
    preview: vi.fn<[], Promise<ActionPreview>>().mockResolvedValue(mockPreview),
    build: vi.fn<[], Promise<BuiltTransaction>>().mockResolvedValue(mockBuiltTx),
  } as unknown as ActionBuilder;
}

function createMockChainAdapter(overrides?: {
  readonly simulate?: SimulationResult;
  readonly signAndSubmit?: TxResult;
}): ChainAdapter {
  return {
    chain: 'sui',
    getBalance: vi.fn(),
    buildTransactionBytes: vi
      .fn<[], Promise<Uint8Array>>()
      .mockResolvedValue(new Uint8Array([1, 2, 3])),
    simulate: vi
      .fn<[], Promise<SimulationResult>>()
      .mockResolvedValue(overrides?.simulate ?? { success: true, gasEstimate: 5000 }),
    signAndSubmit: vi.fn<[], Promise<TxResult>>().mockResolvedValue(
      overrides?.signAndSubmit ?? {
        txDigest: '0xdigest_success',
        status: 'success',
        gasUsed: 4800,
        amountOut: BigInt('98120000'),
      },
    ),
  } as unknown as ChainAdapter;
}

function createMockSigner(): Signer {
  return {
    address: '0xabc',
    publicKey: new Uint8Array([10, 20, 30]),
    sign: vi.fn<[], Promise<Uint8Array>>().mockResolvedValue(new Uint8Array([99])),
  };
}

describe('Pipeline Integration Tests', () => {
  let db: Database.Database;
  let tradeLog: TradeLog;
  let policyRegistry: PolicyCheckRegistry;
  let policyContext: PolicyContext;
  let logger: Logger;

  beforeEach(() => {
    db = openMemoryDatabase();
    insertTestWallet(db);
    tradeLog = new TradeLog(db);

    policyRegistry = new PolicyCheckRegistry();
    policyRegistry.register(new TokenAllowlistCheck());
    policyRegistry.register(new SpendingLimitCheck());

    policyContext = {
      config: chainConfig,
      db,
      oracle: createMockOracle(),
      tradeLog,
      tradeValueUsd: 100,
    };

    logger = createMockLogger();
  });

  afterEach(() => {
    db.close();
  });

  it('full success path: intent -> policy -> preview -> build -> simulate -> sign -> submit -> success', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder();
    const chainAdapter = createMockChainAdapter();
    const mevProtector = new NoOpMevProtector();
    const signer = createMockSigner();

    const result = await executePipeline({
      intent,
      builder,
      chainAdapter,
      policyRegistry,
      policyContext,
      mevProtector,
      tradeLog,
      logger,
      signer,
      watchOnly: false,
    });

    expect(result.status).toBe('success');
    expect(result.txDigest).toBe('0xdigest_success');
    expect(result.gasUsed).toBe(4800);
    expect(result.preview).toEqual(mockPreview);
    expect(result.amountOut).toBe('98120000');

    // Verify trade was logged
    const trades = tradeLog.getRecentTrades('sui', 10);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.policy_decision).toBe('approved');
    expect(trades[0]?.tx_digest).toBe('0xdigest_success');
  });

  it('watch-only path: stops after simulate and returns simulated with gasEstimate', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder();
    const chainAdapter = createMockChainAdapter();
    const mevProtector = new NoOpMevProtector();

    const result = await executePipeline({
      intent,
      builder,
      chainAdapter,
      policyRegistry,
      policyContext,
      mevProtector,
      tradeLog,
      logger,
      watchOnly: true,
    });

    expect(result.status).toBe('simulated');
    expect(result.gasUsed).toBe(5000);
    expect(result.preview).toEqual(mockPreview);

    // signAndSubmit should NOT have been called
    expect(chainAdapter.signAndSubmit).not.toHaveBeenCalled();

    // Trade should still be logged
    const trades = tradeLog.getRecentTrades('sui', 10);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.tx_digest).toBe('watch-only');
  });

  it('policy rejection: token not in allowlist returns rejected with check name', async () => {
    const intent = createSwapIntent({ coinTypeOut: '0xaaa::bbb::DOGE' });
    const builder = createMockBuilder();
    const chainAdapter = createMockChainAdapter();
    const mevProtector = new NoOpMevProtector();

    const result = await executePipeline({
      intent,
      builder,
      chainAdapter,
      policyRegistry,
      policyContext,
      mevProtector,
      tradeLog,
      logger,
      watchOnly: false,
    });

    expect(result.status).toBe('rejected');
    expect(result.rejectionCheck).toBe('token_allowlist');
    expect(result.rejectionReason).toContain('DOGE');

    // Builder should NOT have been called
    expect(builder.preview).not.toHaveBeenCalled();

    // Trade should be logged as rejected
    const trades = tradeLog.getRecentTrades('sui', 10);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.policy_decision).toBe('rejected');
  });

  it('simulation failure: simulate returns success=false -> simulation_failed', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder();
    const chainAdapter = createMockChainAdapter({
      simulate: { success: false, gasEstimate: 0, error: 'InsufficientGas' },
    });
    const mevProtector = new NoOpMevProtector();
    const signer = createMockSigner();

    const result = await executePipeline({
      intent,
      builder,
      chainAdapter,
      policyRegistry,
      policyContext,
      mevProtector,
      tradeLog,
      logger,
      signer,
      watchOnly: false,
    });

    expect(result.status).toBe('simulation_failed');
    expect(result.error).toBe('InsufficientGas');

    // signAndSubmit should NOT have been called
    expect(chainAdapter.signAndSubmit).not.toHaveBeenCalled();
  });
});
