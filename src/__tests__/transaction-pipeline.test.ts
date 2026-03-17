import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type { ActionBuilder, FinishContext } from '../core/action-builder.js';
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
    tradeValueUsd: undefined,
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
    finish: vi.fn(),
    ...overrides,
  };
}

function createMockChainAdapter(overrides?: Partial<ChainAdapter>): ChainAdapter {
  return {
    chain: 'sui',
    getBalance: vi.fn(),
    buildTransactionBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    simulate: vi.fn().mockResolvedValue({
      success: true,
      gasEstimate: 5000,
      rawResponse: { events: [] },
    } satisfies SimulationResult),
    signAndSubmit: vi.fn().mockResolvedValue({
      txDigest: 'TX_DIGEST_ABC',
      status: 'success',
      gasUsed: 4500,
      rawResponse: { events: [] },
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

describe('executePipeline', () => {
  let logger: Logger;
  let policyRegistry: PolicyCheckRegistry;
  let policyContext: PolicyContext;

  beforeEach(() => {
    const db = new Database(':memory:');
    runMigrations(db);
    const tradeLog = new TradeLog(db);

    logger = createMockLogger();
    policyRegistry = new PolicyCheckRegistry();
    policyContext = {
      config: { chain: 'sui', tokenAllowlist: [], dailyLimitUsd: 10000 },
      db,
      oracle: { getPrice: vi.fn() } as unknown as PolicyContext['oracle'],
      tradeLog,
    };
  });

  it('returns success and calls builder.finish with correct context', async () => {
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
      logger,
      signer,
      watchOnly: false,
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('success');
    expect(result.txDigest).toBe('TX_DIGEST_ABC');
    expect(result.gasUsed).toBe(4500);
    expect(result.preview).toBeDefined();
    expect(result.preview?.provider).toBe('7k-swap');

    // Verify builder.finish was called with correct context
    expect(builder.finish).toHaveBeenCalledOnce();
    const ctx = (builder.finish as ReturnType<typeof vi.fn>).mock.calls[0]![0] as FinishContext;
    expect(ctx.intent).toBe(intent);
    expect(ctx.status).toBe('approved');
    expect(ctx.txDigest).toBe('TX_DIGEST_ABC');
    expect(ctx.gasUsed).toBe(4500);
    expect(ctx.rawResponse).toEqual({ events: [] });
    expect(ctx.preview).toBeDefined();
  });

  it('returns rejected and calls builder.finish with rejection context', async () => {
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
      logger,
      watchOnly: false,
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('rejected');
    expect(result.rejectionCheck).toBe('test_reject');
    expect(result.rejectionReason).toBe('SUI is not on the allowlist');

    // Verify builder.finish was called with rejection context
    expect(builder.finish).toHaveBeenCalledOnce();
    const ctx = (builder.finish as ReturnType<typeof vi.fn>).mock.calls[0]![0] as FinishContext;
    expect(ctx.status).toBe('rejected');
    expect(ctx.rejection).toEqual({
      check: 'test_reject',
      reason: 'SUI is not on the allowlist',
    });
  });

  it('returns simulation_failed when simulate fails (no finish call)', async () => {
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
        rawResponse: {},
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
      logger,
      watchOnly: false,
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('simulation_failed');
    expect(result.error).toBe('InsufficientGas');
    // finish should NOT be called for simulation failures
    expect(builder.finish).not.toHaveBeenCalled();
  });

  it('returns simulated and calls builder.finish in watch-only mode', async () => {
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
      logger,
      watchOnly: true,
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('simulated');
    expect(result.preview).toBeDefined();
    expect(result.gasUsed).toBe(5000);

    // signAndSubmit should NOT have been called
    expect(chainAdapter.signAndSubmit).not.toHaveBeenCalled();

    // Verify builder.finish was called with watch-only context
    expect(builder.finish).toHaveBeenCalledOnce();
    const ctx = (builder.finish as ReturnType<typeof vi.fn>).mock.calls[0]![0] as FinishContext;
    expect(ctx.status).toBe('approved');
    expect(ctx.txDigest).toBe('watch-only');
    expect(ctx.gasUsed).toBe(5000);
    expect(ctx.rawResponse).toEqual({ events: [] });
  });

  it('returns error when builder.validate throws (no finish call)', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder({
      builderId: '7k-swap',
      chain: 'sui',
      validate: vi.fn().mockImplementation(() => {
        throw new Error('coinTypeIn and coinTypeOut must be different');
      }),
      preview: vi.fn(),
      build: vi.fn(),
      finish: vi.fn(),
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
      logger,
      watchOnly: false,
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('error');
    expect(result.error).toBe('coinTypeIn and coinTypeOut must be different');
    // finish should NOT be called on error
    expect(builder.finish).not.toHaveBeenCalled();
  });

  it('returns error when signer is missing for non-watch-only (no finish call)', async () => {
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
      logger,
      watchOnly: false,
      // No signer provided
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Signer is required');
    // finish should NOT be called
    expect(builder.finish).not.toHaveBeenCalled();
  });

  it('returns error when signAndSubmit fails (no finish call)', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder();
    const chainAdapter = createMockChainAdapter({
      chain: 'sui',
      getBalance: vi.fn(),
      buildTransactionBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      simulate: vi.fn().mockResolvedValue({ success: true, gasEstimate: 5000, rawResponse: {} }),
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
      logger,
      signer,
      watchOnly: false,
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('error');
    expect(result.error).toBe('RPC timeout');
    // finish should NOT be called on RPC error
    expect(builder.finish).not.toHaveBeenCalled();
  });

  it('returns error when signAndSubmit returns failure status (no finish call)', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder();
    const chainAdapter = createMockChainAdapter({
      chain: 'sui',
      getBalance: vi.fn(),
      buildTransactionBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      simulate: vi.fn().mockResolvedValue({ success: true, gasEstimate: 5000, rawResponse: {} }),
      signAndSubmit: vi.fn().mockResolvedValue({
        txDigest: 'TX_FAIL_123',
        status: 'failure',
        gasUsed: 3000,
        rawResponse: {},
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
      logger,
      signer,
      watchOnly: false,
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('error');
    expect(result.error).toContain('failed on-chain');
    expect(result.txDigest).toBe('TX_FAIL_123');
    // finish should NOT be called for on-chain failures
    expect(builder.finish).not.toHaveBeenCalled();
  });

  it('builder.finish receives intent with tradeValueUsd on success', async () => {
    const intent = createSwapIntent({ tradeValueUsd: 42.5 });
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
      logger,
      signer,
      watchOnly: false,
    };

    await executePipeline(input);

    const ctx = (builder.finish as ReturnType<typeof vi.fn>).mock.calls[0]![0] as FinishContext;
    expect((ctx.intent as SwapIntent).tradeValueUsd).toBe(42.5);
  });

  it('builder.finish receives intent with tradeValueUsd on rejection', async () => {
    const intent = createSwapIntent({ tradeValueUsd: 99.0 });
    const builder = createMockBuilder();
    const chainAdapter = createMockChainAdapter();
    const mevProtector = new NoOpMevProtector();

    policyRegistry.register({
      name: 'test_reject',
      description: 'Always rejects',
      evaluate: async () => ({
        status: 'reject' as const,
        reason: 'denied',
        detail: 'Denied',
      }),
    });

    const input: PipelineInput = {
      intent,
      builder,
      chainAdapter,
      policyRegistry,
      policyContext,
      mevProtector,
      logger,
      watchOnly: false,
    };

    await executePipeline(input);

    const ctx = (builder.finish as ReturnType<typeof vi.fn>).mock.calls[0]![0] as FinishContext;
    expect((ctx.intent as SwapIntent).tradeValueUsd).toBe(99.0);
  });

  it('builder.finish receives intent with tradeValueUsd on watch-only', async () => {
    const intent = createSwapIntent({ tradeValueUsd: 55.25 });
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
      logger,
      watchOnly: true,
    };

    await executePipeline(input);

    const ctx = (builder.finish as ReturnType<typeof vi.fn>).mock.calls[0]![0] as FinishContext;
    expect((ctx.intent as SwapIntent).tradeValueUsd).toBe(55.25);
  });

  it('works when builder has no finish method', async () => {
    const intent = createSwapIntent();
    // Builder without finish
    const builder: ActionBuilder = {
      builderId: '7k-swap',
      chain: 'sui',
      validate: vi.fn(),
      preview: vi.fn().mockResolvedValue(createMockPreview()),
      build: vi.fn().mockResolvedValue({
        transaction: { kind: 'mock-tx' },
        metadata: {},
      }),
    };
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
      logger,
      signer,
      watchOnly: false,
    };

    const result = await executePipeline(input);

    expect(result.status).toBe('success');
  });
});
