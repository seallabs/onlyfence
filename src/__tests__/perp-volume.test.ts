import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActivityLog } from '../db/activity-log.js';
import { openMemoryDatabase } from '../db/connection.js';
import { PerpVolumeCheck } from '../policy/checks/perp-volume.js';
import type { ChainConfig } from '../types/config.js';
import {
  createContext,
  createIntent,
  createPerpPlaceOrderIntent,
  insertTestWallet,
} from './helpers.js';

describe('PerpVolumeCheck', () => {
  let check: PerpVolumeCheck;
  let db: Database.Database;
  let activityLog: ActivityLog;

  const configWithVolume: ChainConfig = {
    rpc: 'https://rpc.example.com',
    perp: {
      allowlist_markets: ['SUI-PERP'],
      max_24h_volume: 1000,
    },
  };

  const configNoVolume: ChainConfig = {
    rpc: 'https://rpc.example.com',
    perp: {
      allowlist_markets: ['SUI-PERP'],
    },
  };

  beforeEach(() => {
    check = new PerpVolumeCheck();
    db = openMemoryDatabase();
    activityLog = new ActivityLog(db);
    insertTestWallet(db);
  });

  it('passes when projected volume within limit', async () => {
    activityLog.logActivity({
      chain_id: 'sui:mainnet',
      wallet_address: '0xabc',
      action: 'perp:place_order',
      policy_decision: 'approved',
      value_usd: 400,
    });
    const intent = createPerpPlaceOrderIntent();
    const ctx = createContext(configWithVolume, db, 500);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('rejects when projected volume exceeds limit', async () => {
    activityLog.logActivity({
      chain_id: 'sui:mainnet',
      wallet_address: '0xabc',
      action: 'perp:place_order',
      policy_decision: 'approved',
      value_usd: 800,
    });
    const intent = createPerpPlaceOrderIntent();
    const ctx = createContext(configWithVolume, db, 300);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('reject');
    expect(result.reason).toBe('exceeds_24h_perp_volume');
    expect(result.detail).toContain('$800.00');
    expect(result.detail).toContain('$300.00');
    expect(result.detail).toContain('$1000.00');
  });

  it('passes when no max_24h_volume in config', async () => {
    const intent = createPerpPlaceOrderIntent();
    const ctx = createContext(configNoVolume, db, 999999);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('passes for non-perp action', async () => {
    const intent = createIntent();
    const ctx = createContext(configWithVolume, db, 999999);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('passes when tradeValueUsd unavailable (permissive)', async () => {
    const intent = createPerpPlaceOrderIntent();
    const ctx = createContext(configWithVolume, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
    expect(result.metadata?.['skipped']).toBe(true);
  });
});
