import { describe, it, expect, beforeEach } from 'vitest';
import { TokenAllowlistCheck } from '../policy/checks/token-allowlist.js';
import { openMemoryDatabase } from '../db/connection.js';
import { createIntent, createContext } from './helpers.js';
import type { ChainConfig } from '../types/config.js';
import type Database from 'better-sqlite3';

describe('TokenAllowlistCheck', () => {
  let check: TokenAllowlistCheck;
  let db: Database.Database;

  beforeEach(() => {
    check = new TokenAllowlistCheck();
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
        coinTypeIn: '0x2::sui::SUI',
        coinTypeOut: '0xdba3::usdc::USDC',
        amountIn: '100',
        slippageBps: 100,
      },
    });
    const result = await check.evaluate(intent, createContext(config, db));

    expect(result.status).toBe('pass');
  });

  it('should pass with case-insensitive token matching', async () => {
    const config: ChainConfig = {
      rpc: 'https://rpc.example.com',
      allowlist: { tokens: ['SUI', 'USDC'] },
    };
    const intent = createIntent({
      params: {
        coinTypeIn: '0x2::sui::sui',
        coinTypeOut: '0xdba3::usdc::usdc',
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
    const intent = createIntent({
      params: {
        coinTypeIn: '0xdead::scam::SCAM',
        coinTypeOut: '0xdba3::usdc::USDC',
        amountIn: '100',
        slippageBps: 100,
      },
    });
    const result = await check.evaluate(intent, createContext(config, db));

    expect(result.status).toBe('reject');
    expect(result.reason).toBe('token_not_allowed');
    expect(result.metadata?.['direction']).toBe('from');
    expect(result.metadata?.['token']).toBe('SCAM');
  });

  it('should reject when toToken is not in the allowlist', async () => {
    const config: ChainConfig = {
      rpc: 'https://rpc.example.com',
      allowlist: { tokens: ['SUI', 'USDC'] },
    };
    const intent = createIntent({
      params: {
        coinTypeIn: '0x2::sui::SUI',
        coinTypeOut: '0xdead::scam::SCAM',
        amountIn: '100',
        slippageBps: 100,
      },
    });
    const result = await check.evaluate(intent, createContext(config, db));

    expect(result.status).toBe('reject');
    expect(result.reason).toBe('token_not_allowed');
    expect(result.metadata?.['direction']).toBe('to');
    expect(result.metadata?.['token']).toBe('SCAM');
  });

  it('should pass when allowlist config is missing', async () => {
    const config: ChainConfig = {
      rpc: 'https://rpc.example.com',
    };
    const intent = createIntent({
      params: {
        coinTypeIn: '0xdead::any::ANY_TOKEN',
        coinTypeOut: '0xdead::what::WHATEVER',
        amountIn: '100',
        slippageBps: 100,
      },
    });
    const result = await check.evaluate(intent, createContext(config, db));

    expect(result.status).toBe('pass');
  });
});
