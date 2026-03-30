import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/connection.js';
import { PerpOrderSizeCheck } from '../policy/checks/perp-order-size.js';
import type { ChainConfig } from '../types/config.js';
import {
  createContext,
  createIntent,
  createPerpPlaceOrderIntent,
  insertTestWallet,
} from './helpers.js';

describe('PerpOrderSizeCheck', () => {
  let check: PerpOrderSizeCheck;
  let db: Database.Database;

  const configWithLimit: ChainConfig = {
    rpc: 'https://rpc.example.com',
    perp: {
      allowlist_markets: ['SUI-PERP'],
      max_single_order: 500,
    },
  };

  const configNoLimit: ChainConfig = {
    rpc: 'https://rpc.example.com',
    perp: {
      allowlist_markets: ['SUI-PERP'],
    },
  };

  beforeEach(() => {
    check = new PerpOrderSizeCheck();
    db = openMemoryDatabase();
    insertTestWallet(db);
  });

  it('passes when tradeValueUsd within limit', async () => {
    const intent = createPerpPlaceOrderIntent({
      orderType: 'LIMIT',
      limitPriceE9: '5000000000',
      quantityE9: '1000000000',
    });
    // tradeValueUsd=5 (pre-computed), within 500 limit
    const ctx = createContext(configWithLimit, db, 5);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('rejects when tradeValueUsd exceeds limit', async () => {
    const intent = createPerpPlaceOrderIntent({
      orderType: 'LIMIT',
      limitPriceE9: '600000000000',
      quantityE9: '1000000000',
    });
    // tradeValueUsd=600 (pre-computed), exceeds 500 limit
    const ctx = createContext(configWithLimit, db, 600);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('reject');
    expect(result.reason).toBe('exceeds_single_order_limit');
  });

  it('passes market order when tradeValueUsd within limit', async () => {
    const intent = createPerpPlaceOrderIntent({
      orderType: 'MARKET',
      quantityE9: '1000000000',
    });
    (intent as { params: Record<string, unknown> }).params.limitPriceE9 = undefined;
    // tradeValueUsd=3.8 (pre-computed from perpMarketPrice * quantity)
    const ctx = createContext(configWithLimit, db, 3.8);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('rejects market order when tradeValueUsd exceeds limit', async () => {
    const intent = createPerpPlaceOrderIntent({
      orderType: 'MARKET',
      quantityE9: '1000000000',
    });
    (intent as { params: Record<string, unknown> }).params.limitPriceE9 = undefined;
    // tradeValueUsd=600 (pre-computed), exceeds 500 limit
    const ctx = createContext(configWithLimit, db, 600);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('reject');
    expect(result.reason).toBe('exceeds_single_order_limit');
  });

  it('passes when tradeValueUsd unavailable (permissive)', async () => {
    const intent = createPerpPlaceOrderIntent({
      orderType: 'MARKET',
      quantityE9: '1000000000',
    });
    (intent as { params: Record<string, unknown> }).params.limitPriceE9 = undefined;
    const ctx = createContext(configWithLimit, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
    expect(result.metadata?.['skipped']).toBe(true);
  });

  it('passes when no max_single_order in config', async () => {
    const intent = createPerpPlaceOrderIntent({
      orderType: 'LIMIT',
      limitPriceE9: '999000000000',
      quantityE9: '1000000000',
    });
    const ctx = createContext(configNoLimit, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('passes for non-perp action', async () => {
    const intent = createIntent();
    const ctx = createContext(configWithLimit, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });
});
