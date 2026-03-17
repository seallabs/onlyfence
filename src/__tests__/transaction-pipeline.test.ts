import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type { ActionBuilder } from '../core/action-builder.js';
import type { ChainAdapter } from '../chain/adapter.js';
import type { MevProtector } from '../core/mev-protector.js';
import type { PolicyContext } from '../policy/context.js';
import type { ActionPreview, SwapIntent } from '../core/action-types.js';
import type { CheckResult, SimulationResult, TxResult, Signer } from '../types/result.js';
import { NoOpMevProtector } from '../core/mev-protector.js';
import { PolicyCheckRegistry } from '../policy/registry.js';
import { TradeLog } from '../db/trade-log.js';
import { runMigrations } from '../db/migrations.js';
import { executePipeline } from '../core/transaction-pipeline.js';
import type { PipelineInput } from '../core/transaction-pipeline.js';
import { REJECTED_BY_KEY } from '../policy/check.js';

function createMockLogger(): Logger {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
    level: 'info',
  } as unknown as Logger;
  return logger;
}

function createSwapIntent(overrides?: Partial<SwapIntent>): SwapIntent {
  return {
    chain: 'sui',
    action: 'swap',
    walletAddress: '0x' + 'a'.repeat(64),
    params: {
      coinTypeIn: '0x2::sui::SUI',
      coinTypeOut: '0xdba3::usdc::USDC',
      amountIn: '1000000000',
      slippageBps: 100,
    },
    ...overrides,
  };
}

function createMockPreview(): ActionPreview {
  return {
    description: 'Swap 1 SUI -> USDC',
    expectedOutput: '3500000',
    provider: '7k-swap',
    priceImpact: 0.01,
    buildData: { tx: 'mock' },
  };
}

function createMockBuilder(overrides?: Partial<ActionBuilder>): ActionBuilder {
  return {
    builderId: '7k-swap',
    chain: 'sui',
    validate: vi.fn(),
    preview: vi.fn().mockResolvedValue(createMockPreview()),
    build: vi.fn().mockResolvedValue({
      transaction: { kind: 'mock-tx' },
      metadata: { coinTypeIn: '0x2::sui::SUI', coinTypeOut: '0xdba3::usdc::USDC' },
    }),
    ...overrides,
  };
}

function createMockChainAdapter(overrides?: Partial<ChainAdapter>): ChainAdapter {
  return {
    chain: 'sui',
    getBalance: vi.fn(),
    buildTransactionBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    simulate: vi
      .fn()
      .mockResolvedValue({ success: true, gasEstimate: 5000 } satisfies SimulationResult),
    signAndSubmit: vi.fn().mockResolvedValue({
      txDigest: 'TX_DIGEST_ABC',
      status: 'success',
      gasUsed: 4500,
      amountOut: BigInt('3500000'),
    } satisfies TxResult),
    ...overrides,
  };
}

function createMockSigner(): Signer {
  return {
    address: '0x' + 'a'.repeat(64),
    publicKey: new Uint8Array(32),
    sign: vi.fn().mockResolvedValue(new Uint8Array(64)),
  };
}

function createInMemoryTradeLog(): { tradeLog: TradeLog; db: Database.Database } {
  const db = new Database(':memory:');
  runMigrations(db);
  const tradeLog = new TradeLog(db);
  return { tradeLog, db };
}

describe('executePipeline', () => {
  let tradeLog: TradeLog;
  let db: Database.Database;
  let logger: Logger;
  let policyRegistry: PolicyCheckRegistry;
  let policyContext: PolicyContext;

  beforeEach(() => {
    const mem = createInMemoryTradeLog();
    tradeLog = mem.tradeLog;
    db = mem.db;

    // Insert a wallet row to satisfy the FOREIGN KEY on trades.wallet_address
    const walletAddr = '0x' + 'a'.repeat(64);
    db.prepare(`INSERT INTO wallets (chain, address) VALUES (?, ?)`).run('sui', walletAddr);

    logger = createMockLogger();
    policyRegistry = new PolicyCheckRegistry();
    policyContext = {
      config: { chain: 'sui', tokenAllowlist: [], dailyLimitUsd: 10000 },
      db,
      oracle: { getPrice: vi.fn() } as unknown as PolicyContext['oracle'],
      tradeLog,
    };
  });

  it('returns success when all steps pass', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder();
    const chainAdapter = createMockChainAdapter();
    const signer = createMockSigner();
    const mevProtector = new NoOpMevProtector();

    const input: PipelineInput = {
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
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('success');
    expect(result.txDigest).toBe('TX_DIGEST_ABC');
    expect(result.gasUsed).toBe(4500);
    expect(result.amountOut).toBe('3500000');
    expect(result.preview).toBeDefined();
    expect(result.preview?.provider).toBe('7k-swap');

    // Verify trade was logged
    const trades = tradeLog.getRecentTrades('sui', 10);
    expect(trades).toHaveLength(1);
    expect(trades[0]!.policy_decision).toBe('approved');
    expect(trades[0]!.tx_digest).toBe('TX_DIGEST_ABC');
    expect(trades[0]!.from_token).toBe('0x2::sui::SUI');
    expect(trades[0]!.to_token).toBe('0xdba3::usdc::USDC');
  });

  it('returns rejected when policy rejects', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder();
    const chainAdapter = createMockChainAdapter();
    const mevProtector = new NoOpMevProtector();

    // Register a rejecting policy check
    policyRegistry.register({
      name: 'test_reject',
      description: 'Always rejects',
      evaluate: async () => ({
        status: 'reject' as const,
        reason: 'token_not_allowed',
        detail: 'SUI is not on the allowlist',
      }),
    });

    const input: PipelineInput = {
      intent,
      builder,
      chainAdapter,
      policyRegistry,
      policyContext,
      mevProtector,
      tradeLog,
      logger,
      watchOnly: false,
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('rejected');
    expect(result.rejectionCheck).toBe('test_reject');
    expect(result.rejectionReason).toBe('SUI is not on the allowlist');

    // Verify rejected trade was logged
    const trades = tradeLog.getRecentTrades('sui', 10);
    expect(trades).toHaveLength(1);
    expect(trades[0]!.policy_decision).toBe('rejected');
    expect(trades[0]!.rejection_check).toBe('test_reject');
  });

  it('returns simulation_failed when simulate fails', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder();
    const chainAdapter = createMockChainAdapter({
      chain: 'sui',
      getBalance: vi.fn(),
      buildTransactionBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      simulate: vi.fn().mockResolvedValue({
        success: false,
        gasEstimate: 0,
        error: 'InsufficientGas',
      } satisfies SimulationResult),
      signAndSubmit: vi.fn(),
    });
    const mevProtector = new NoOpMevProtector();

    const input: PipelineInput = {
      intent,
      builder,
      chainAdapter,
      policyRegistry,
      policyContext,
      mevProtector,
      tradeLog,
      logger,
      watchOnly: false,
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('simulation_failed');
    expect(result.error).toBe('InsufficientGas');
  });

  it('returns simulated when watchOnly is true', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder();
    const chainAdapter = createMockChainAdapter();
    const mevProtector = new NoOpMevProtector();

    const input: PipelineInput = {
      intent,
      builder,
      chainAdapter,
      policyRegistry,
      policyContext,
      mevProtector,
      tradeLog,
      logger,
      watchOnly: true,
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('simulated');
    expect(result.preview).toBeDefined();
    expect(result.gasUsed).toBe(5000);

    // signAndSubmit should NOT have been called
    expect(chainAdapter.signAndSubmit).not.toHaveBeenCalled();

    // Verify trade was logged with watch-only digest
    const trades = tradeLog.getRecentTrades('sui', 10);
    expect(trades).toHaveLength(1);
    expect(trades[0]!.tx_digest).toBe('watch-only');
    expect(trades[0]!.policy_decision).toBe('approved');
  });

  it('returns error when builder.validate throws', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder({
      builderId: '7k-swap',
      chain: 'sui',
      validate: vi.fn().mockImplementation(() => {
        throw new Error('coinTypeIn and coinTypeOut must be different');
      }),
      preview: vi.fn(),
      build: vi.fn(),
    });
    const chainAdapter = createMockChainAdapter();
    const mevProtector = new NoOpMevProtector();

    const input: PipelineInput = {
      intent,
      builder,
      chainAdapter,
      policyRegistry,
      policyContext,
      mevProtector,
      tradeLog,
      logger,
      watchOnly: false,
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('error');
    expect(result.error).toBe('coinTypeIn and coinTypeOut must be different');
  });

  it('returns error when signer is missing for non-watch-only', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder();
    const chainAdapter = createMockChainAdapter();
    const mevProtector = new NoOpMevProtector();

    const input: PipelineInput = {
      intent,
      builder,
      chainAdapter,
      policyRegistry,
      policyContext,
      mevProtector,
      tradeLog,
      logger,
      watchOnly: false,
      // No signer provided
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Signer is required');
  });

  it('returns error when signAndSubmit fails', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder();
    const chainAdapter = createMockChainAdapter({
      chain: 'sui',
      getBalance: vi.fn(),
      buildTransactionBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      simulate: vi.fn().mockResolvedValue({ success: true, gasEstimate: 5000 }),
      signAndSubmit: vi.fn().mockRejectedValue(new Error('RPC timeout')),
    });
    const signer = createMockSigner();
    const mevProtector = new NoOpMevProtector();

    const input: PipelineInput = {
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
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('error');
    expect(result.error).toBe('RPC timeout');
  });

  it('returns error when signAndSubmit returns failure status', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder();
    const chainAdapter = createMockChainAdapter({
      chain: 'sui',
      getBalance: vi.fn(),
      buildTransactionBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      simulate: vi.fn().mockResolvedValue({ success: true, gasEstimate: 5000 }),
      signAndSubmit: vi.fn().mockResolvedValue({
        txDigest: 'TX_FAIL_123',
        status: 'failure',
        gasUsed: 3000,
      } satisfies TxResult),
    });
    const signer = createMockSigner();
    const mevProtector = new NoOpMevProtector();

    const input: PipelineInput = {
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
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('error');
    expect(result.error).toContain('failed on-chain');
    expect(result.txDigest).toBe('TX_FAIL_123');
  });
});
