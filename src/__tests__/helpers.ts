import type { PolicyContext } from '../policy/context.js';
import type { TradeIntent } from '../types/intent.js';
import type { ChainConfig } from '../types/config.js';
import type { OracleClient } from '../oracle/client.js';
import { TradeLog } from '../db/trade-log.js';
import type { TradeRecord } from '../db/trade-log.js';
import { SUI_CHAIN_ID } from '../chain/sui/adapter.js';
import type Database from 'better-sqlite3';

/**
 * Create a mock OracleClient that returns a fixed price.
 */
export function createMockOracle(price: number = 1.0): OracleClient {
  return {
    async getPrice(_token: string): Promise<number> {
      return price;
    },
  };
}

/**
 * Create a TradeIntent with sensible defaults, overridable via partial.
 */
export function createIntent(overrides?: Partial<TradeIntent>): TradeIntent {
  return {
    chain: SUI_CHAIN_ID,
    action: 'swap',
    fromToken: 'SUI',
    toToken: 'USDC',
    amount: 100n,
    walletAddress: '0xabc',
    ...overrides,
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
    db,
    oracle: createMockOracle(),
    tradeLog: new TradeLog(db),
    ...(tradeValueUsd !== undefined ? { tradeValueUsd } : {}),
  };
}

/**
 * Insert a test wallet into the database for foreign key constraints.
 */
export function insertTestWallet(db: Database.Database, address: string = '0xabc'): void {
  db.prepare(
    `INSERT OR IGNORE INTO wallets (chain, address, is_primary) VALUES ('sui:mainnet', ?, 1)`,
  ).run(address);
}

/**
 * Create a TradeRecord with sensible defaults, overridable via partial.
 */
export function createTradeRecord(overrides?: Partial<TradeRecord>): TradeRecord {
  return {
    chain: SUI_CHAIN_ID,
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
