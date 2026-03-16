import type { ChainConfig } from '../types/config.js';
import type { OracleClient } from '../oracle/client.js';
import type { TradeLog } from '../db/trade-log.js';
import type Database from 'better-sqlite3';

/**
 * Context provided to each PolicyCheck during evaluation.
 * Contains all dependencies a check might need to make its decision.
 */
export interface PolicyContext {
  /** Chain-specific configuration including allowlists, limits, etc. */
  readonly config: ChainConfig;

  /** SQLite database connection for direct queries */
  readonly db: Database.Database;

  /** Oracle client for fetching token prices */
  readonly oracle: OracleClient;

  /** Trade log for querying trade history (cached prepared statements) */
  readonly tradeLog: TradeLog;

  /** Pre-resolved USD value of the trade (if oracle succeeded) */
  readonly tradeValueUsd?: number;
}
