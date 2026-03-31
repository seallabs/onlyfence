import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  PerpCancelOrderIntent,
  PerpDepositIntent,
  PerpWithdrawIntent,
} from '../core/action-types.js';
import { openMemoryDatabase } from '../db/connection.js';
import { PerpMarketAllowlistCheck } from '../policy/checks/perp-market-allowlist.js';
import type { ChainConfig } from '../types/config.js';
import {
  createContext,
  createIntent,
  createPerpPlaceOrderIntent,
  insertTestWallet,
} from './helpers.js';

describe('PerpMarketAllowlistCheck', () => {
  let check: PerpMarketAllowlistCheck;
  let db: Database.Database;

  const configWithPerp: ChainConfig = {
    rpc: 'https://rpc.example.com',
    perp: {
      allowlist_markets: ['SUI-PERP', 'BTC-PERP'],
    },
  };

  const configNoPerp: ChainConfig = {
    rpc: 'https://rpc.example.com',
  };

  const configEmptyAllowlist: ChainConfig = {
    rpc: 'https://rpc.example.com',
    perp: {
      allowlist_markets: [],
    },
  };

  beforeEach(() => {
    check = new PerpMarketAllowlistCheck();
    db = openMemoryDatabase();
    insertTestWallet(db);
  });

  it('passes place_order with market in allowlist', async () => {
    const intent = createPerpPlaceOrderIntent({ marketSymbol: 'SUI-PERP' });
    const ctx = createContext(configWithPerp, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('rejects place_order with market not in allowlist', async () => {
    const intent = createPerpPlaceOrderIntent({ marketSymbol: 'ETH-PERP' });
    const ctx = createContext(configWithPerp, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('reject');
    expect(result.reason).toBe('market_not_allowed');
  });

  it('rejects place_order when perp config absent', async () => {
    const intent = createPerpPlaceOrderIntent();
    const ctx = createContext(configNoPerp, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('reject');
    expect(result.reason).toBe('perp_not_enabled');
  });

  it('rejects place_order when allowlist_markets is empty', async () => {
    const intent = createPerpPlaceOrderIntent();
    const ctx = createContext(configEmptyAllowlist, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('reject');
    expect(result.reason).toBe('perp_not_enabled');
  });

  it('passes cancel_order always (even for de-listed markets)', async () => {
    const intent: PerpCancelOrderIntent = {
      action: 'perp:cancel_order',
      chainId: 'sui:mainnet',
      walletAddress: '0xabc',
      params: { protocol: 'bluefin_pro', marketSymbol: 'DELISTED-PERP' },
    };
    const ctx = createContext(configNoPerp, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('passes deposit when allowlist is non-empty (perp enabled)', async () => {
    const intent: PerpDepositIntent = {
      action: 'perp:deposit',
      chainId: 'sui:mainnet',
      walletAddress: '0xabc',
      params: { protocol: 'bluefin_pro', coinType: '0xusdc', amount: '1000000', decimals: 6 },
    };
    const ctx = createContext(configWithPerp, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('rejects deposit when config absent', async () => {
    const intent: PerpDepositIntent = {
      action: 'perp:deposit',
      chainId: 'sui:mainnet',
      walletAddress: '0xabc',
      params: { protocol: 'bluefin_pro', coinType: '0xusdc', amount: '1000000', decimals: 6 },
    };
    const ctx = createContext(configNoPerp, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('reject');
    expect(result.reason).toBe('perp_not_enabled');
  });

  it('passes withdraw always', async () => {
    const intent: PerpWithdrawIntent = {
      action: 'perp:withdraw',
      chainId: 'sui:mainnet',
      walletAddress: '0xabc',
      params: { protocol: 'bluefin_pro', assetSymbol: 'USDC', amountE9: '1000000000' },
    };
    const ctx = createContext(configNoPerp, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });

  it('passes non-perp action (trade:swap)', async () => {
    const intent = createIntent();
    const ctx = createContext(configNoPerp, db);
    const result = await check.evaluate(intent, ctx);
    expect(result.status).toBe('pass');
  });
});
