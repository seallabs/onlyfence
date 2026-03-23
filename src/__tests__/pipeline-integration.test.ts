import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainAdapter } from '../chain/adapter.js';
import { parseSwapEvent } from '../chain/sui/7k/events.js';
import { tryResolveTokenAddress } from '../chain/sui/tokens.js';
import type { ActionBuilder, BuiltTransaction, FinishContext } from '../core/action-builder.js';
import type { SwapIntent } from '../core/action-types.js';
import { NoOpMevProtector } from '../core/mev-protector.js';
import { executePipeline } from '../core/transaction-pipeline.js';
import { ActivityLog } from '../db/activity-log.js';
import { openMemoryDatabase } from '../db/connection.js';
import { SpendingLimitCheck } from '../policy/checks/spending-limit.js';
import { TokenAllowlistCheck } from '../policy/checks/token-allowlist.js';
import type { PolicyContext } from '../policy/context.js';
import { PolicyCheckRegistry } from '../policy/registry.js';
import type { ChainConfig } from '../types/config.js';
import type { Signer, SimulationResult, TxResult } from '../types/result.js';
import { createIntent, createMockLogger, insertTestWallet } from './helpers.js';

// --- Shared fixtures ---

const chainConfig: ChainConfig = {
  rpc: 'https://test.sui.io',
  allowlist: { tokens: ['SUI', 'USDC'] },
  limits: { max_single_trade: 1000, max_24h_volume: 5000 },
};

const MOCK_METADATA: Record<string, unknown> = {
  action: 'swap',
  description: 'Swap 100 SUI -> USDC',
  expectedOutput: '98120000',
  provider: '7k',
  priceImpact: 0.01,
};

const mockBuiltTx: BuiltTransaction = {
  transaction: { kind: 'mock-tx' },
  metadata: MOCK_METADATA,
};

/**
 * Creates a mock builder with a real finish() implementation that
 * parses swap events and logs trades — matching SuiSwapBuilder behavior.
 */
function createMockBuilder(activityLog: ActivityLog): ActionBuilder {
  return {
    builderId: 'test-builder',
    chainId: 'sui:mainnet',
    validate: vi.fn(),
    build: vi.fn<[], Promise<BuiltTransaction>>().mockResolvedValue(mockBuiltTx),
    finish(context: FinishContext): void {
      const { intent, status, metadata, rawResponse, txDigest, gasUsed, rejection } = context;
      const tradeValueUsd = intent.action === 'trade:swap' ? intent.tradeValueUsd : undefined;

      if (intent.action !== 'trade:swap') return;

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
        const expectedOutput = metadata?.['expectedOutput'];
        amountOut = typeof expectedOutput === 'string' ? expectedOutput : undefined;
      }

      activityLog.logActivity({
        chain_id: intent.chainId,
        wallet_address: intent.walletAddress,
        action: 'trade:swap',
        token_a_type: intent.params.coinTypeIn,
        token_a_amount: intent.params.amountIn,
        token_b_type: intent.params.coinTypeOut,
        policy_decision: status,
        ...(amountOut !== undefined ? { token_b_amount: amountOut } : {}),
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
    chainId: 'sui:mainnet',
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
  let activityLog: ActivityLog;
  let policyRegistry: PolicyCheckRegistry;
  let policyContext: PolicyContext;
  let logger: Logger;

  beforeEach(() => {
    db = openMemoryDatabase();
    insertTestWallet(db);
    activityLog = new ActivityLog(db);

    policyRegistry = new PolicyCheckRegistry();
    policyRegistry.register(new TokenAllowlistCheck(tryResolveTokenAddress));
    policyRegistry.register(new SpendingLimitCheck());

    policyContext = {
      config: chainConfig,
      activityLog,
      tradeValueUsd: 100,
    };

    logger = createMockLogger();
  });

  afterEach(() => {
    db.close();
  });

  it('full success path: intent -> policy -> build -> simulate -> sign -> submit -> finish', async () => {
    const intent = createIntent();
    const builder = createMockBuilder(activityLog);
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
    expect(result.metadata).toEqual(MOCK_METADATA);

    // Verify trade was logged with event-parsed amounts
    const trades = activityLog.getRecentActivities('sui:mainnet', 10);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.policy_decision).toBe('approved');
    expect(trades[0]?.tx_digest).toBe('0xdigest_success');
    expect(trades[0]?.token_b_amount).toBe('98120000');
  });

  it('watch-only path: stops after simulate and returns simulated with gasEstimate', async () => {
    const intent = createIntent();
    const builder = createMockBuilder(activityLog);
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
    expect(result.metadata).toEqual(MOCK_METADATA);

    // signAndSubmit should NOT have been called
    expect(chainAdapter.signAndSubmit).not.toHaveBeenCalled();

    // Trade should still be logged with event-parsed amountOut
    const trades = activityLog.getRecentActivities('sui:mainnet', 10);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.tx_digest).toBe('watch-only');
    expect(trades[0]?.token_b_amount).toBe('98120000');
  });

  it('policy rejection: token not in allowlist returns rejected with check name', async () => {
    const intent = createIntent({
      params: { coinTypeOut: '0xaaa::bbb::DOGE' },
    });
    const builder = createMockBuilder(activityLog);
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

    // Builder should NOT have been called for build
    expect(builder.build).not.toHaveBeenCalled();

    // Trade should be logged as rejected via builder.finish
    const trades = activityLog.getRecentActivities('sui:mainnet', 10);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.policy_decision).toBe('rejected');
  });

  it('simulation failure: simulate returns success=false -> simulation_failed', async () => {
    const intent = createIntent();
    const builder = createMockBuilder(activityLog);
    const chainAdapter = createMockChainAdapter({
      simulate: {
        success: false,
        gasEstimate: 0,
        error: 'InsufficientGas',
        rawResponse: {},
      },
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
