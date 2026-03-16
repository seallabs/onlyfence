import { describe, it, expect, beforeEach } from 'vitest';
import { SpendingLimitCheck } from '../policy/checks/spending-limit.js';
import { openMemoryDatabase } from '../db/connection.js';
import { logTrade } from '../db/trade-log.js';
import { createIntent, createContext, insertTestWallet } from './helpers.js';
import type { ChainConfig } from '../types/config.js';
import type Database from 'better-sqlite3';

describe('SpendingLimitCheck', () => {
  let check: SpendingLimitCheck;
  let db: Database.Database;

  const configWithLimits: ChainConfig = {
    rpc: 'https://rpc.example.com',
    limits: {
      max_single_trade: 200,
      max_24h_volume: 500,
    },
  };

  beforeEach(() => {
    check = new SpendingLimitCheck();
    db = openMemoryDatabase();
    insertTestWallet(db, '0xabc');
  });

  it('should have correct name and description', () => {
    expect(check.name).toBe('spending_limit');
    expect(check.description).toBeTruthy();
  });

  it('should pass when trade is within single trade and 24h volume limits', async () => {
    const intent = createIntent();
    const ctx = createContext(configWithLimits, db, 100);
    const result = await check.evaluate(intent, ctx);

    expect(result.status).toBe('pass');
  });

  it('should reject when trade exceeds single trade limit', async () => {
    const intent = createIntent();
    const ctx = createContext(configWithLimits, db, 250);
    const result = await check.evaluate(intent, ctx);

    expect(result.status).toBe('reject');
    expect(result.reason).toBe('exceeds_single_trade_limit');
    expect(result.metadata?.['limit']).toBe(200);
    expect(result.metadata?.['requested']).toBe(250);
  });

  it('should reject when trade pushes 24h volume over limit', async () => {
    // Insert prior approved trades summing to $400
    logTrade(db, {
      chain: 'sui',
      wallet_address: '0xabc',
      action: 'swap',
      from_token: 'SUI',
      to_token: 'USDC',
      amount_in: '100',
      value_usd: 400,
      policy_decision: 'approved',
    });

    const intent = createIntent();
    const ctx = createContext(configWithLimits, db, 150);
    const result = await check.evaluate(intent, ctx);

    expect(result.status).toBe('reject');
    expect(result.reason).toBe('exceeds_24h_volume');
    expect(result.metadata?.['limit']).toBe(500);
    expect(result.metadata?.['current']).toBe(400);
    expect(result.metadata?.['requested']).toBe(150);
  });

  it('should pass when limits config is missing', async () => {
    const config: ChainConfig = {
      rpc: 'https://rpc.example.com',
    };
    const intent = createIntent();
    const ctx = createContext(config, db, 10000);
    const result = await check.evaluate(intent, ctx);

    expect(result.status).toBe('pass');
  });

  it('should pass when oracle price is unavailable (tradeValueUsd undefined)', async () => {
    const intent = createIntent();
    const ctx = createContext(configWithLimits, db, undefined);
    const result = await check.evaluate(intent, ctx);

    expect(result.status).toBe('pass');
    expect(result.metadata?.['skipped']).toBe(true);
    expect(result.metadata?.['reason']).toBe('oracle_price_unavailable');
  });

  it('should not count rejected trades in 24h volume', async () => {
    // Insert a rejected trade (should not count)
    logTrade(db, {
      chain: 'sui',
      wallet_address: '0xabc',
      action: 'swap',
      from_token: 'SUI',
      to_token: 'USDC',
      amount_in: '100',
      value_usd: 400,
      policy_decision: 'rejected',
      rejection_reason: 'test',
      rejection_check: 'test_check',
    });

    const intent = createIntent();
    const ctx = createContext(configWithLimits, db, 150);
    const result = await check.evaluate(intent, ctx);

    expect(result.status).toBe('pass');
  });
});
