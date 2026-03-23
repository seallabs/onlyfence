import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveTokenAddress, tryResolveTokenAddress } from '../chain/sui/tokens.js';
import type { ClaimRewardsIntent } from '../core/action-types.js';
import { openMemoryDatabase } from '../db/connection.js';
import { TokenAllowlistCheck } from '../policy/checks/token-allowlist.js';
import type { ChainConfig } from '../types/config.js';
import { createContext, createIntent, createSupplyIntent } from './helpers.js';

/** Resolved canonical coin type for SUI */
const SUI_COIN_TYPE = resolveTokenAddress('SUI');
/** Resolved canonical coin type for USDC */
const USDC_COIN_TYPE = resolveTokenAddress('USDC');

describe('TokenAllowlistCheck', () => {
  let check: TokenAllowlistCheck;
  let db: Database.Database;

  beforeEach(() => {
    check = new TokenAllowlistCheck(tryResolveTokenAddress);
    db = openMemoryDatabase();
  });

  it('should have correct name and description', () => {
    expect(check.name).toBe('token_allowlist');
    expect(check.description).toBeTruthy();
  });

  it('should pass when both tokens are in the allowlist', async () => {
    const config: ChainConfig = {
      rpc: 'https://rpc.example.com',
      allowlist: { tokens: ['SUI', 'USDC', 'USDT'] },
    };
    const intent = createIntent({
      params: {
        coinTypeIn: SUI_COIN_TYPE,
        coinTypeOut: USDC_COIN_TYPE,
        amountIn: '100',
        slippageBps: 100,
      },
    });
    const result = await check.evaluate(intent, createContext(config, db));

    expect(result.status).toBe('pass');
  });

  it('should pass with case-insensitive allowlist matching', async () => {
    const config: ChainConfig = {
      rpc: 'https://rpc.example.com',
      allowlist: { tokens: ['sui', 'usdc'] },
    };
    const intent = createIntent({
      params: {
        coinTypeIn: SUI_COIN_TYPE,
        coinTypeOut: USDC_COIN_TYPE,
        amountIn: '100',
        slippageBps: 100,
      },
    });
    const result = await check.evaluate(intent, createContext(config, db));

    expect(result.status).toBe('pass');
  });

  it('should reject when fromToken is not in the allowlist', async () => {
    const config: ChainConfig = {
      rpc: 'https://rpc.example.com',
      allowlist: { tokens: ['SUI', 'USDC'] },
    };
    const scamCoinType = resolveTokenAddress('0xdead::scam::SCAM');
    const intent = createIntent({
      params: {
        coinTypeIn: scamCoinType,
        coinTypeOut: USDC_COIN_TYPE,
        amountIn: '100',
        slippageBps: 100,
      },
    });
    const result = await check.evaluate(intent, createContext(config, db));

    expect(result.status).toBe('reject');
    expect(result.reason).toBe('token_not_allowed');
    expect(result.metadata?.['direction']).toBe('from');
    expect(result.metadata?.['token']).toBe(scamCoinType);
  });

  it('should reject when toToken is not in the allowlist', async () => {
    const config: ChainConfig = {
      rpc: 'https://rpc.example.com',
      allowlist: { tokens: ['SUI', 'USDC'] },
    };
    const scamCoinType = resolveTokenAddress('0xdead::scam::SCAM');
    const intent = createIntent({
      params: {
        coinTypeIn: SUI_COIN_TYPE,
        coinTypeOut: scamCoinType,
        amountIn: '100',
        slippageBps: 100,
      },
    });
    const result = await check.evaluate(intent, createContext(config, db));

    expect(result.status).toBe('reject');
    expect(result.reason).toBe('token_not_allowed');
    expect(result.metadata?.['direction']).toBe('to');
    expect(result.metadata?.['token']).toBe(scamCoinType);
  });

  it('should pass when allowlist config is missing', async () => {
    const config: ChainConfig = {
      rpc: 'https://rpc.example.com',
    };
    const intent = createIntent({
      params: {
        coinTypeIn: resolveTokenAddress('0xdead::any::ANY_TOKEN'),
        coinTypeOut: resolveTokenAddress('0xdead::what::WHATEVER'),
        amountIn: '100',
        slippageBps: 100,
      },
    });
    const result = await check.evaluate(intent, createContext(config, db));

    expect(result.status).toBe('pass');
  });

  it('should pass for claim_rewards action (no token to check)', async () => {
    const config: ChainConfig = {
      rpc: 'https://rpc.example.com',
      allowlist: { tokens: ['SUI', 'USDC'] },
    };
    const intent: ClaimRewardsIntent = {
      chainId: 'sui:mainnet',
      action: 'lending:claim_rewards',
      walletAddress: '0xabc',
      params: { protocol: 'alphalend' },
    };
    const result = await check.evaluate(intent, createContext(config, db));

    expect(result.status).toBe('pass');
  });

  it('should pass for supply intent when token is in allowlist', async () => {
    const config: ChainConfig = {
      rpc: 'https://rpc.example.com',
      allowlist: { tokens: ['SUI', 'USDC'] },
    };
    const intent = createSupplyIntent({
      params: {
        coinType: SUI_COIN_TYPE,
        amount: '1000000000',
        protocol: 'alphalend',
        marketId: '1',
      },
    });
    const result = await check.evaluate(intent, createContext(config, db));

    expect(result.status).toBe('pass');
  });

  it('should reject supply intent when token is NOT in allowlist', async () => {
    const config: ChainConfig = {
      rpc: 'https://rpc.example.com',
      allowlist: { tokens: ['SUI', 'USDC'] },
    };
    const scamCoinType = resolveTokenAddress('0xdead::scam::SCAM');
    const intent = createSupplyIntent({
      params: {
        coinType: scamCoinType,
        amount: '1000000000',
        protocol: 'alphalend',
        marketId: '1',
      },
    });
    const result = await check.evaluate(intent, createContext(config, db));

    expect(result.status).toBe('reject');
    expect(result.reason).toBe('token_not_allowed');
    expect(result.metadata?.['token']).toBe(scamCoinType);
  });
});
