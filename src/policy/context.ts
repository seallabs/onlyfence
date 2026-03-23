import type { ActivityLog } from '../db/activity-log.js';
import type { ChainConfig } from '../types/config.js';

/**
 * Context provided to each PolicyCheck during evaluation.
 * Contains all dependencies a check might need to make its decision.
 *
 * Note: raw database access is intentionally excluded — policy checks
 * should use ActivityLog for activity queries rather than running arbitrary SQL.
 */
export interface PolicyContext {
  /** Chain-specific configuration including allowlists, limits, etc. */
  readonly config: ChainConfig;

  /** Activity log for querying activity history (cached prepared statements) */
  readonly activityLog: ActivityLog;

  /** Pre-resolved USD value of the trade (if price lookup succeeded) */
  readonly tradeValueUsd?: number;
}
