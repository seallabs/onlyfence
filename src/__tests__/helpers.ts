import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import { vi } from 'vitest';
import { SUI_CHAIN_ID } from '../chain/sui/adapter.js';
import { resolveTokenAddress } from '../chain/sui/tokens.js';
import type { BorrowIntent, SupplyIntent, SwapIntent } from '../core/action-types.js';
import type { DataProvider, TokenMetadata } from '../core/data-provider.js';
import type { LendingRecord } from '../db/lending-log.js';
import type { TradeRecord } from '../db/trade-log.js';
import { TradeLog } from '../db/trade-log.js';
import type { PolicyContext } from '../policy/context.js';
import type { ChainConfig } from '../types/config.js';

/**
 * Create a mock Logger with all standard pino methods stubbed.
 */
export function createMockLogger(): Logger {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
    level: 'info',
  } as unknown as Logger;
  return logger;
}

/**
 * Create a mock DataProvider that returns fixed values.
 */
export function createMockDataProvider(price: number = 1.0): DataProvider {
  return {
    chain: 'sui',
    async getPrice(_address: string): Promise<number> {
      return price;
    },
    async getPrices(addresses: string[]): Promise<Record<string, number>> {
      const result: Record<string, number> = {};
      for (const addr of addresses) {
        result[addr] = price;
      }
      return result;
    },
    async getMetadata(address: string): Promise<TokenMetadata> {
      return { address, symbol: 'MOCK', decimals: 9 };
    },
    async getMetadatas(addresses: string[]): Promise<Record<string, TokenMetadata>> {
      const result: Record<string, TokenMetadata> = {};
      for (const addr of addresses) {
        result[addr] = { address: addr, symbol: 'MOCK', decimals: 9 };
      }
      return result;
    },
  };
}

/**
 * Create a SwapIntent with sensible defaults, overridable via partial.
 */
export function createIntent(
  overrides?: Partial<SwapIntent> & { params?: Partial<SwapIntent['params']> },
): SwapIntent {
  const { params: paramOverrides, ...rest } = overrides ?? {};
  return {
    chainId: SUI_CHAIN_ID,
    action: 'swap',
    walletAddress: '0xabc',
    params: {
      coinTypeIn: resolveTokenAddress('SUI'),
      coinTypeOut: resolveTokenAddress('USDC'),
      amountIn: '100000000',
      slippageBps: 100,
      ...paramOverrides,
    },
    tradeValueUsd: undefined,
    ...rest,
  };
}

/**
 * Create a PolicyContext from a chain config and database.
 */
export function createContext(
  config: ChainConfig,
  db: Database.Database,
  tradeValueUsd?: number,
): PolicyContext {
  return {
    config,
    tradeLog: new TradeLog(db),
    ...(tradeValueUsd !== undefined ? { tradeValueUsd } : {}),
  };
}

/**
 * Insert a test wallet into the database for foreign key constraints.
 */
export function insertTestWallet(db: Database.Database, address: string = '0xabc'): void {
  db.prepare(
    `INSERT OR IGNORE INTO wallets (chain_id, address, is_primary) VALUES ('sui:mainnet', ?, 1)`,
  ).run(address);
}

/**
 * Create a TradeRecord with sensible defaults, overridable via partial.
 */
export function createTradeRecord(overrides?: Partial<TradeRecord>): TradeRecord {
  return {
    chain_id: SUI_CHAIN_ID,
    wallet_address: '0xabc',
    action: 'swap',
    from_token: 'SUI',
    to_token: 'USDC',
    amount_in: '100000000',
    amount_out: '98120000',
    value_usd: 98.0,
    tx_digest: '0xdigest123',
    gas_cost: 0.0021,
    policy_decision: 'approved',
    ...overrides,
  };
}

/**
 * Create a SupplyIntent with sensible defaults, overridable via partial.
 */
export function createSupplyIntent(
  overrides?: Partial<SupplyIntent> & { params?: Partial<SupplyIntent['params']> },
): SupplyIntent {
  const { params: paramOverrides, ...rest } = overrides ?? {};
  return {
    chainId: SUI_CHAIN_ID,
    action: 'supply',
    walletAddress: '0xabc',
    params: {
      coinType: resolveTokenAddress('SUI'),
      amount: '1000000000',
      protocol: 'alphalend',
      marketId: '1',
      ...paramOverrides,
    },
    valueUsd: undefined,
    ...rest,
  };
}

/**
 * Create a BorrowIntent with sensible defaults, overridable via partial.
 */
export function createBorrowIntent(
  overrides?: Partial<BorrowIntent> & { params?: Partial<BorrowIntent['params']> },
): BorrowIntent {
  const { params: paramOverrides, ...rest } = overrides ?? {};
  return {
    chainId: SUI_CHAIN_ID,
    action: 'borrow',
    walletAddress: '0xabc',
    params: {
      coinType: resolveTokenAddress('SUI'),
      amount: '500000000',
      protocol: 'alphalend',
      marketId: '1',
      ...paramOverrides,
    },
    valueUsd: undefined,
    ...rest,
  };
}

/**
 * Create a LendingRecord with sensible defaults, overridable via partial.
 */
export function createLendingRecord(overrides?: Partial<LendingRecord>): LendingRecord {
  return {
    chain_id: SUI_CHAIN_ID,
    wallet_address: '0xabc',
    action: 'supply',
    protocol: 'alphalend',
    market_id: '1',
    coin_type: '0x2::sui::SUI',
    token_symbol: 'SUI',
    amount: '1000000000',
    value_usd: 100.0,
    tx_digest: '0xdigest123',
    gas_cost: 0.002,
    policy_decision: 'approved',
    ...overrides,
  };
}
