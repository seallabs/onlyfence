import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PerpCancelOrderIntent } from '../core/action-types.js';
import { openMemoryDatabase } from '../db/connection.js';
import { PerpLeverageCapCheck } from '../policy/checks/perp-leverage-cap.js';
import type { ChainConfig } from '../types/config.js';
import {
  createContext,
  createIntent,
  createPerpPlaceOrderIntent,
  insertTestWallet,
} from './helpers.js';

describe('PerpLeverageCapCheck', () => {
  let check: PerpLeverageCapCheck;
  let db: Database.Database;

  const configWithLeverage: ChainConfig = {
    rpc: 'https://rpc.example.com',
    perp: {
      allowlist_markets: ['SUI-PERP'],
      max_leverage: 10,
    },
  };

  const configNoLeverage: ChainConfig = {
    rpc: 'https://rpc.example.com',
    perp: {
      allowlist_markets: ['SUI-PERP'],
    },
  };

  beforeEach(() => {
    check = new PerpLeverageCapCheck();
    db = openMemoryDatabase();
    insertTestWallet(db);
  });

  it('passes when leverage within config cap and on-chain max', async () => {
    // leverageE9 = 5x (5000000000), config cap = 10, on-chain max = 20
    const intent = createPerpPlaceOrderIntent({ leverageE9: '5000000000' });
    const ctx = createContext(configWithLeverage, db, undefined, {
      perpMarketMaxLeverage: 20,
    });
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('rejects when leverage exceeds config cap (config < on-chain)', async () => {
    // leverageE9 = 15x, config cap = 10, on-chain max = 20
    const intent = createPerpPlaceOrderIntent({ leverageE9: '15000000000' });
    const ctx = createContext(configWithLeverage, db, undefined, {
      perpMarketMaxLeverage: 20,
    });
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('reject');
    expect(result.reason).toBe('exceeds_leverage_cap');
    expect(result.detail).toContain('config');
  });

  it('rejects when leverage exceeds on-chain max (on-chain < config)', async () => {
    // leverageE9 = 8x, config cap = 10, on-chain max = 5
    const intent = createPerpPlaceOrderIntent({ leverageE9: '8000000000' });
    const ctx = createContext(configWithLeverage, db, undefined, {
      perpMarketMaxLeverage: 5,
    });
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('reject');
    expect(result.reason).toBe('exceeds_leverage_cap');
    expect(result.detail).toContain('on-chain');
  });

  it('passes when no max_leverage in config', async () => {
    const intent = createPerpPlaceOrderIntent({ leverageE9: '50000000000' });
    const ctx = createContext(configNoLeverage, db, undefined, {
      perpMarketMaxLeverage: 100,
    });
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('passes when no explicit leverage in intent', async () => {
    const intent = createPerpPlaceOrderIntent();
    // Remove leverageE9
    (intent as { params: Record<string, unknown> }).params.leverageE9 = undefined;
    const ctx = createContext(configWithLeverage, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('passes for non-perp action', async () => {
    const intent = createIntent();
    const ctx = createContext(configWithLeverage, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('passes for cancel_order', async () => {
    const intent: PerpCancelOrderIntent = {
      action: 'perp:cancel_order',
      chainId: 'sui:mainnet',
      walletAddress: '0xabc',
      params: { protocol: 'bluefin_pro', marketSymbol: 'SUI-PERP' },
    };
    const ctx = createContext(configWithLeverage, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });
});
