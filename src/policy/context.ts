import type { ActivityLogReader } from '../db/activity-log.js';
import type { ChainConfig } from '../types/config.js';

/**
 * Context provided to each PolicyCheck during evaluation.
 * Contains all dependencies a check might need to make its decision.
 *
 * Note: raw database access is intentionally excluded — policy checks
 * should use ActivityLogReader for activity queries rather than running arbitrary SQL.
 */
export interface PolicyContext {
  /** Chain-specific configuration including allowlists, limits, etc. */
  readonly config: ChainConfig;

  /** Activity log reader for querying activity history */
  readonly activityLog: ActivityLogReader;

  /** Pre-resolved USD value of the trade (if price lookup succeeded) */
  readonly tradeValueUsd?: number;
}
