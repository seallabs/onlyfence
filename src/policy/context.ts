import type { ChainConfig } from '../types/config.js';
import type { OracleClient } from '../oracle/client.js';
import type { TradeLog } from '../db/trade-log.js';

/**
 * Context provided to each PolicyCheck during evaluation.
 * Contains all dependencies a check might need to make its decision.
 *
 * Note: raw database access is intentionally excluded — policy checks
 * should use TradeLog for trade queries rather than running arbitrary SQL.
 */
export interface PolicyContext {
  /** Chain-specific configuration including allowlists, limits, etc. */
  readonly config: ChainConfig;

  /** Oracle client for fetching token prices */
  readonly oracle: OracleClient;

  /** Trade log for querying trade history (cached prepared statements) */
  readonly tradeLog: TradeLog;

  /** Pre-resolved USD value of the trade (if oracle succeeded) */
  readonly tradeValueUsd?: number;
}
