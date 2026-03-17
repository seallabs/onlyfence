import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from 'pino';
import type Database from 'better-sqlite3';
import type { ChainAdapter } from '../chain/adapter.js';
import type { ActionBuilder, BuiltTransaction, FinishContext } from '../core/action-builder.js';
import { parseSwapEvent } from '../chain/sui/7k/events.js';
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

/**
 * Creates a mock builder with a real finish() implementation that
 * parses swap events and logs trades — matching SuiSwapBuilder behavior.
 */
function createMockBuilder(tradeLog: TradeLog): ActionBuilder {
  return {
    builderId: 'test-builder',
    chain: 'sui',
    validate: vi.fn(),
    preview: vi.fn<[], Promise<ActionPreview>>().mockResolvedValue(mockPreview),
    build: vi.fn<[], Promise<BuiltTransaction>>().mockResolvedValue(mockBuiltTx),
    finish(context: FinishContext): void {
      const { intent, status, preview, rawResponse, txDigest, gasUsed, rejection } = context;
      const tradeValueUsd = intent.action === 'swap' ? intent.tradeValueUsd : undefined;

      if (intent.action !== 'swap') return;

      // Parse amounts from events
      let amountOut: string | undefined;
      if (rawResponse !== undefined) {
        const response = rawResponse as {
          events?: readonly { type: string; parsedJson: unknown }[];
        };
        if (Array.isArray(response?.events)) {
          const parsed = parseSwapEvent(response.events);
          amountOut = parsed?.amountOut;
        }
      }
      if (amountOut === undefined) {
        amountOut = preview?.expectedOutput;
      }

      tradeLog.logTrade({
        chain: intent.chain,
        wallet_address: intent.walletAddress,
        action: intent.action,
        from_token: intent.params.coinTypeIn,
        to_token: intent.params.coinTypeOut,
        amount_in: intent.params.amountIn,
        policy_decision: status,
        ...(amountOut !== undefined ? { amount_out: amountOut } : {}),
        ...(txDigest !== undefined ? { tx_digest: txDigest } : {}),
        ...(gasUsed !== undefined ? { gas_cost: gasUsed } : {}),
        ...(rejection?.reason !== undefined ? { rejection_reason: rejection.reason } : {}),
        ...(rejection?.check !== undefined ? { rejection_check: rejection.check } : {}),
        ...(tradeValueUsd !== undefined ? { value_usd: tradeValueUsd } : {}),
      });
    },
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
    simulate: vi.fn<[], Promise<SimulationResult>>().mockResolvedValue(
      overrides?.simulate ?? {
        success: true,
        gasEstimate: 5000,
        rawResponse: {
          events: [
            {
              type: '0x17c0b1f7a6ad73f51268f16b8c06c049eecc2f28a270cdd29c06e3d2dea23302::settle::Swap',
              parsedJson: { amount_in: '100000000', amount_out: '98120000' },
            },
          ],
        },
      },
    ),
    signAndSubmit: vi.fn<[], Promise<TxResult>>().mockResolvedValue(
      overrides?.signAndSubmit ?? {
        txDigest: '0xdigest_success',
        status: 'success',
        gasUsed: 4800,
        rawResponse: {
          events: [
            {
              type: '0x17c0b1f7a6ad73f51268f16b8c06c049eecc2f28a270cdd29c06e3d2dea23302::settle::Swap',
              parsedJson: { amount_in: '100000000', amount_out: '98120000' },
            },
          ],
        },
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

  it('full success path: intent -> policy -> preview -> build -> simulate -> sign -> submit -> finish', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder(tradeLog);
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
      logger,
      signer,
      watchOnly: false,
    });

    expect(result.status).toBe('success');
    expect(result.txDigest).toBe('0xdigest_success');
    expect(result.gasUsed).toBe(4800);
    expect(result.preview).toEqual(mockPreview);

    // Verify trade was logged with event-parsed amounts
    const trades = tradeLog.getRecentTrades('sui', 10);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.policy_decision).toBe('approved');
    expect(trades[0]?.tx_digest).toBe('0xdigest_success');
    expect(trades[0]?.amount_out).toBe('98120000');
  });

  it('watch-only path: stops after simulate and returns simulated with gasEstimate', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder(tradeLog);
    const chainAdapter = createMockChainAdapter();
    const mevProtector = new NoOpMevProtector();

    const result = await executePipeline({
      intent,
      builder,
      chainAdapter,
      policyRegistry,
      policyContext,
      mevProtector,
      logger,
      watchOnly: true,
    });

    expect(result.status).toBe('simulated');
    expect(result.gasUsed).toBe(5000);
    expect(result.preview).toEqual(mockPreview);

    // signAndSubmit should NOT have been called
    expect(chainAdapter.signAndSubmit).not.toHaveBeenCalled();

    // Trade should still be logged with event-parsed amountOut
    const trades = tradeLog.getRecentTrades('sui', 10);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.tx_digest).toBe('watch-only');
    expect(trades[0]?.amount_out).toBe('98120000');
  });

  it('policy rejection: token not in allowlist returns rejected with check name', async () => {
    const intent = createSwapIntent({ coinTypeOut: '0xaaa::bbb::DOGE' });
    const builder = createMockBuilder(tradeLog);
    const chainAdapter = createMockChainAdapter();
    const mevProtector = new NoOpMevProtector();

    const result = await executePipeline({
      intent,
      builder,
      chainAdapter,
      policyRegistry,
      policyContext,
      mevProtector,
      logger,
      watchOnly: false,
    });

    expect(result.status).toBe('rejected');
    expect(result.rejectionCheck).toBe('token_allowlist');
    expect(result.rejectionReason).toContain('DOGE');

    // Builder should NOT have been called for preview/build
    expect(builder.preview).not.toHaveBeenCalled();

    // Trade should be logged as rejected via builder.finish
    const trades = tradeLog.getRecentTrades('sui', 10);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.policy_decision).toBe('rejected');
  });

  it('simulation failure: simulate returns success=false -> simulation_failed', async () => {
    const intent = createSwapIntent();
    const builder = createMockBuilder(tradeLog);
    const chainAdapter = createMockChainAdapter({
      simulate: { success: false, gasEstimate: 0, error: 'InsufficientGas', rawResponse: {} },
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
