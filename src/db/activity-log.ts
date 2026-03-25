import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';
import type {
  ActivityAction,
  ActivityCategory,
  ChainId,
  DefiProtocol,
} from '../core/action-types.js';

/**
 * Record to insert into the activities table.
 * Common fields are top-level; action-specific fields go in `metadata`.
 */
export interface ActivityRecord {
  readonly chain_id: ChainId;
  readonly wallet_address: string;
  readonly action: ActivityAction;
  readonly protocol?: DefiProtocol;
  readonly token_a_type?: string | undefined;
  /** Raw smallest unit (e.g. MIST for SUI, not human-readable) */
  readonly token_a_amount?: string | undefined;
  readonly token_b_type?: string | undefined;
  /** Raw smallest unit (e.g. MIST for SUI, not human-readable) */
  readonly token_b_amount?: string | undefined;
  readonly value_usd?: number | undefined;
  readonly tx_digest?: string | undefined;
  readonly gas_cost?: number | undefined;
  readonly policy_decision: 'approved' | 'rejected';
  readonly rejection_reason?: string | undefined;
  readonly rejection_check?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

/**
 * Row retrieved from the activities table.
 */
export interface ActivityRow {
  readonly id: number;
  readonly chain_id: string;
  readonly wallet_address: string;
  readonly category: string;
  readonly action: string;
  readonly protocol: string | null;
  readonly token_a_type: string | null;
  /** Joined from coin_metadata; null if metadata not cached */
  readonly token_a_symbol: string | null;
  /** Joined from coin_metadata; null if metadata not cached */
  readonly token_a_decimals: number | null;
  /** Raw smallest unit (e.g. MIST for SUI, not human-readable) */
  readonly token_a_amount: string | null;
  readonly token_b_type: string | null;
  /** Joined from coin_metadata; null if metadata not cached */
  readonly token_b_symbol: string | null;
  /** Joined from coin_metadata; null if metadata not cached */
  readonly token_b_decimals: number | null;
  /** Raw smallest unit (e.g. MIST for SUI, not human-readable) */
  readonly token_b_amount: string | null;
  readonly value_usd: number | null;
  readonly tx_digest: string | null;
  readonly gas_cost: number | null;
  readonly policy_decision: string;
  readonly rejection_reason: string | null;
  readonly rejection_check: string | null;
  readonly metadata: string | null;
  readonly created_at: string;
}

/**
 * Read-only interface for querying rolling trade volume.
 *
 * Implemented by both ActivityLog (SQLite-backed) and InMemoryTradeWindow
 * (daemon in-memory). Policy checks depend on this interface, not the
 * concrete class, so the daemon can swap in its fast in-memory version.
 */
export interface ActivityLogReader {
  getRolling24hVolume(chainId: ChainId): number;
}

/**
 * Unified activity log with cached prepared SQL statements.
 *
 * Replaces TradeLog + LendingLog with a single API for all DeFi activity
 * data access. Supports category/action filtering for backward-compatible
 * queries (e.g., 24h swap volume for policy checks).
 */
export class ActivityLog implements ActivityLogReader {
  private readonly insertStmt: Statement;
  private readonly rolling24hStmt: Statement;
  private readonly recentStmt: Statement;
  private readonly recentByCategoryStmt: Statement;
  private readonly countStmt: Statement;
  private readonly countByCategoryStmt: Statement;

  constructor(db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO activities (
        chain_id, wallet_address, category, action, protocol,
        token_a_type, token_a_amount,
        token_b_type, token_b_amount,
        value_usd, tx_digest, gas_cost,
        policy_decision, rejection_reason, rejection_check,
        metadata
      ) VALUES (
        @chain_id, @wallet_address,
        @category, @action, @protocol,
        @token_a_type, @token_a_amount,
        @token_b_type, @token_b_amount,
        @value_usd, @tx_digest, @gas_cost,
        @policy_decision, @rejection_reason, @rejection_check,
        @metadata
      )
    `);

    this.rolling24hStmt = db.prepare(`
      SELECT COALESCE(SUM(value_usd), 0) as total
      FROM activities
      WHERE chain_id = ?
        AND created_at > datetime('now', '-24 hours')
        AND policy_decision = 'approved'
        AND action = 'trade:swap'
    `);

    const selectWithJoin = `
      SELECT a.*,
        cm_a.symbol AS token_a_symbol, cm_a.decimals AS token_a_decimals,
        cm_b.symbol AS token_b_symbol, cm_b.decimals AS token_b_decimals
      FROM activities a
      LEFT JOIN coin_metadata cm_a ON cm_a.coin_type = a.token_a_type AND cm_a.chain_id = a.chain_id
      LEFT JOIN coin_metadata cm_b ON cm_b.coin_type = a.token_b_type AND cm_b.chain_id = a.chain_id`;

    this.recentStmt = db.prepare(`
      ${selectWithJoin}
      WHERE a.chain_id = ?
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `);

    this.recentByCategoryStmt = db.prepare(`
      ${selectWithJoin}
      WHERE a.chain_id = ? AND a.category = ?
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `);

    this.countStmt = db.prepare(`
      SELECT COUNT(*) as count FROM activities WHERE chain_id = ?
    `);

    this.countByCategoryStmt = db.prepare(`
      SELECT COUNT(*) as count FROM activities WHERE chain_id = ? AND category = ?
    `);
  }

  /**
   * Insert an activity record into the database.
   *
   * @returns The inserted row ID
   */
  logActivity(record: ActivityRecord): number {
    const colonIdx = record.action.indexOf(':');
    if (colonIdx <= 0) {
      throw new Error(`Invalid action format "${record.action}": expected "category:action"`);
    }
    const category = record.action.substring(0, colonIdx);

    const result = this.insertStmt.run({
      chain_id: record.chain_id,
      wallet_address: record.wallet_address,
      category,
      action: record.action,
      protocol: record.protocol ?? null,
      token_a_type: record.token_a_type ?? null,
      token_a_amount: record.token_a_amount ?? null,
      token_b_type: record.token_b_type ?? null,
      token_b_amount: record.token_b_amount ?? null,
      value_usd: record.value_usd ?? null,
      tx_digest: record.tx_digest ?? null,
      gas_cost: record.gas_cost ?? null,
      policy_decision: record.policy_decision,
      rejection_reason: record.rejection_reason ?? null,
      rejection_check: record.rejection_check ?? null,
      metadata: record.metadata !== undefined ? JSON.stringify(record.metadata) : null,
    });
    return Number(result.lastInsertRowid);
  }

  /**
   * Get the rolling 24-hour approved swap volume in USD for a given chain.
   * Only counts category='swap' activities.
   */
  getRolling24hVolume(chainId: ChainId): number {
    const row = this.rolling24hStmt.get(chainId) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  /**
   * Get recent activities for a given chain, ordered by most recent first.
   * Returns ALL categories. Use `getRecentByCategory()` to filter.
   */
  getRecentActivities(chain: string, limit: number, offset = 0): ActivityRow[] {
    return this.recentStmt.all(chain, limit, offset) as ActivityRow[];
  }

  /**
   * Get recent activities filtered by category prefix (e.g., 'swap', 'lending').
   */
  getRecentByCategory(
    chain: string,
    category: ActivityCategory,
    limit: number,
    offset = 0,
  ): ActivityRow[] {
    return this.recentByCategoryStmt.all(chain, category, limit, offset) as ActivityRow[];
  }

  /**
   * Get the total activity count for a given chain (all categories).
   */
  getActivityCount(chain: string): number {
    const row = this.countStmt.get(chain) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /**
   * Get the total activity count for a given chain and category.
   */
  getActivityCountByCategory(chain: string, category: ActivityCategory): number {
    const row = this.countByCategoryStmt.get(chain, category) as { count: number } | undefined;
    return row?.count ?? 0;
  }
}
