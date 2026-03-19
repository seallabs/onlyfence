import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyCheckRegistry } from '../policy/registry.js';
import { TokenAllowlistCheck } from '../policy/checks/token-allowlist.js';
import { resolveTokenAddress, tryResolveTokenAddress } from '../chain/sui/tokens.js';
import { SpendingLimitCheck } from '../policy/checks/spending-limit.js';
import { openMemoryDatabase } from '../db/connection.js';
import { createIntent, createContext } from './helpers.js';
import type { ChainConfig } from '../types/config.js';
import type Database from 'better-sqlite3';

describe('PolicyCheckRegistry', () => {
  let registry: PolicyCheckRegistry;
  let db: Database.Database;

  const fullConfig: ChainConfig = {
    rpc: 'https://rpc.example.com',
    allowlist: { tokens: ['SUI', 'USDC', 'USDT'] },
    limits: {
      max_single_trade: 200,
      max_24h_volume: 500,
    },
  };

  beforeEach(() => {
    registry = new PolicyCheckRegistry();
    db = openMemoryDatabase();
  });

  it('should register checks and track them', () => {
    registry.register(new TokenAllowlistCheck(tryResolveTokenAddress));
    registry.register(new SpendingLimitCheck());

    expect(registry.size).toBe(2);
    expect(registry.registeredChecks).toEqual(['token_allowlist', 'spending_limit']);
  });

  it('should reject duplicate check names', () => {
    registry.register(new TokenAllowlistCheck(tryResolveTokenAddress));

    expect(() => registry.register(new TokenAllowlistCheck(tryResolveTokenAddress))).toThrow(
      'already registered',
    );
  });

  it('should pass all checks when intent is valid', async () => {
    registry.register(new TokenAllowlistCheck(tryResolveTokenAddress));
    registry.register(new SpendingLimitCheck());

    const intent = createIntent();
    const ctx = createContext(fullConfig, db, 100);
    const result = await registry.evaluateAll(intent, ctx);

    expect(result.status).toBe('pass');
  });

  it('should short-circuit on first rejection (token check fails first)', async () => {
    registry.register(new TokenAllowlistCheck(tryResolveTokenAddress));
    registry.register(new SpendingLimitCheck());

    const intent = createIntent({
      params: {
        coinTypeIn: resolveTokenAddress('0xdead::scam::SCAM'),
        coinTypeOut: resolveTokenAddress('USDC'),
        amountIn: '100',
        slippageBps: 100,
      },
    });
    const ctx = createContext(fullConfig, db, 100);
    const result = await registry.evaluateAll(intent, ctx);

    expect(result.status).toBe('reject');
    expect(result.reason).toBe('token_not_allowed');
    expect(result.metadata?.['rejectedBy']).toBe('token_allowlist');
  });

  it('should reach spending limit check when tokens pass', async () => {
    registry.register(new TokenAllowlistCheck(tryResolveTokenAddress));
    registry.register(new SpendingLimitCheck());

    const intent = createIntent();
    const ctx = createContext(fullConfig, db, 300);
    const result = await registry.evaluateAll(intent, ctx);

    expect(result.status).toBe('reject');
    expect(result.reason).toBe('exceeds_single_trade_limit');
    expect(result.metadata?.['rejectedBy']).toBe('spending_limit');
  });

  it('should pass with empty registry', async () => {
    const intent = createIntent();
    const ctx = createContext(fullConfig, db, 100);
    const result = await registry.evaluateAll(intent, ctx);

    expect(result.status).toBe('pass');
  });
});
