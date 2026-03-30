import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PerpWithdrawIntent } from '../core/action-types.js';
import { ActivityLog } from '../db/activity-log.js';
import { openMemoryDatabase } from '../db/connection.js';
import { PerpWithdrawLimitCheck } from '../policy/checks/perp-withdraw-limit.js';
import type { ChainConfig } from '../types/config.js';
import {
  createContext,
  createIntent,
  createPerpPlaceOrderIntent,
  insertTestWallet,
} from './helpers.js';

function makeWithdrawIntent(): PerpWithdrawIntent {
  return {
    action: 'perp:withdraw',
    chainId: 'sui:mainnet',
    walletAddress: '0xabc',
    params: { protocol: 'bluefin_pro', assetSymbol: 'USDC', amountE9: '100000000000' },
  };
}

describe('PerpWithdrawLimitCheck', () => {
  let check: PerpWithdrawLimitCheck;
  let db: Database.Database;
  let activityLog: ActivityLog;

  const configWithLimit: ChainConfig = {
    rpc: 'https://rpc.example.com',
    perp: {
      allowlist_markets: ['SUI-PERP'],
      max_24h_withdraw: 500,
    },
  };

  const configNoLimit: ChainConfig = {
    rpc: 'https://rpc.example.com',
    perp: {
      allowlist_markets: ['SUI-PERP'],
    },
  };

  beforeEach(() => {
    check = new PerpWithdrawLimitCheck();
    db = openMemoryDatabase();
    activityLog = new ActivityLog(db);
    insertTestWallet(db);
  });

  it('passes when projected withdrawal within limit', async () => {
    activityLog.logActivity({
      chain_id: 'sui:mainnet',
      wallet_address: '0xabc',
      action: 'perp:withdraw',
      policy_decision: 'approved',
      value_usd: 200,
    });
    const intent = makeWithdrawIntent();
    const ctx = createContext(configWithLimit, db, 100);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('rejects when projected withdrawal exceeds limit', async () => {
    activityLog.logActivity({
      chain_id: 'sui:mainnet',
      wallet_address: '0xabc',
      action: 'perp:withdraw',
      policy_decision: 'approved',
      value_usd: 400,
    });
    const intent = makeWithdrawIntent();
    const ctx = createContext(configWithLimit, db, 200);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('reject');
    expect(result.reason).toBe('exceeds_24h_perp_withdraw');
  });

  it('passes when no max_24h_withdraw in config', async () => {
    const intent = makeWithdrawIntent();
    const ctx = createContext(configNoLimit, db, 999999);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('passes when tradeValueUsd unavailable (permissive)', async () => {
    const intent = makeWithdrawIntent();
    const ctx = createContext(configWithLimit, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
    expect(result.metadata?.['skipped']).toBe(true);
  });

  it('passes for non-perp action', async () => {
    const intent = createIntent();
    const ctx = createContext(configWithLimit, db, 999999);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('passes for non-withdraw perp action', async () => {
    const intent = createPerpPlaceOrderIntent();
    const ctx = createContext(configWithLimit, db, 999999);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });
});
