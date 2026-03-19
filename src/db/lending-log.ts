import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';

/**
 * Lending action types stored in the lending_activities table.
 */
export type LendingAction = 'supply' | 'borrow' | 'withdraw' | 'repay' | 'claim_rewards';

/**
 * Represents a lending activity record to be inserted into the database.
 *
 * coin_type, token_symbol, and amount are optional to accommodate
 * claim_rewards which has no specific token or amount at intent time.
 */
export interface LendingRecord {
  readonly chain_id: string;
  readonly wallet_address: string;
  readonly action: LendingAction;
  readonly protocol: string;
  readonly market_id?: string;
  readonly coin_type?: string;
  readonly token_symbol?: string;
  readonly amount?: string;
  readonly value_usd?: number;
  readonly tx_digest?: string;
  readonly gas_cost?: number;
  readonly policy_decision: 'approved' | 'rejected';
  readonly rejection_reason?: string;
  readonly rejection_check?: string;
}

/**
 * Represents a lending activity row retrieved from the database.
 */
export interface LendingRow {
  readonly id: number;
  readonly chain_id: string;
  readonly wallet_address: string;
  readonly action: string;
  readonly protocol: string;
  readonly market_id: string | null;
  readonly coin_type: string | null;
  readonly token_symbol: string | null;
  readonly amount: string | null;
  readonly value_usd: number | null;
  readonly tx_digest: string | null;
  readonly gas_cost: number | null;
  readonly policy_decision: string;
  readonly rejection_reason: string | null;
  readonly rejection_check: string | null;
  readonly created_at: string;
}

/**
 * Lending log with cached prepared SQL statements for performance.
 *
 * This is the sole API for lending activity data access. Caching prepared
 * statements avoids re-parsing SQL on every call, which matters for hot
 * paths (e.g., policy checks, TUI polling).
 */
export class LendingLog {
  private readonly insertStmt: Statement;
  private readonly recentStmt: Statement;
  private readonly countStmt: Statement;

  constructor(db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO lending_activities (
        chain_id, wallet_address, action, protocol,
        market_id, coin_type, token_symbol, amount,
        value_usd, tx_digest, gas_cost,
        policy_decision, rejection_reason, rejection_check
      ) VALUES (
        @chain_id, @wallet_address, @action, @protocol,
        @market_id, @coin_type, @token_symbol, @amount,
        @value_usd, @tx_digest, @gas_cost,
        @policy_decision, @rejection_reason, @rejection_check
      )
    `);

    this.recentStmt = db.prepare(`
      SELECT * FROM lending_activities
      WHERE chain_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);

    this.countStmt = db.prepare(`
      SELECT COUNT(*) as count FROM lending_activities WHERE chain_id = ?
    `);
  }

  /**
   * Insert a lending activity record into the database.
   *
   * @param record - Lending activity record to insert
   * @returns The inserted row ID
   */
  logActivity(record: LendingRecord): number {
    const result = this.insertStmt.run({
      chain_id: record.chain_id,
      wallet_address: record.wallet_address,
      action: record.action,
      protocol: record.protocol,
      market_id: record.market_id ?? null,
      coin_type: record.coin_type ?? null,
      token_symbol: record.token_symbol ?? null,
      amount: record.amount ?? null,
      value_usd: record.value_usd ?? null,
      tx_digest: record.tx_digest ?? null,
      gas_cost: record.gas_cost ?? null,
      policy_decision: record.policy_decision,
      rejection_reason: record.rejection_reason ?? null,
      rejection_check: record.rejection_check ?? null,
    });

    return Number(result.lastInsertRowid);
  }

  /**
   * Get recent lending activities for a given chain, ordered by most recent first.
   *
   * @param chain - CAIP-2 chain identifier (e.g., "sui:mainnet")
   * @param limit - Maximum number of activities to return
   * @param offset - Number of activities to skip (for pagination)
   * @returns Array of lending activity rows
   */
  getRecentActivities(chain: string, limit: number, offset = 0): LendingRow[] {
    return this.recentStmt.all(chain, limit, offset) as LendingRow[];
  }

  /**
   * Get the total number of lending activities for a given chain.
   *
   * @param chain - CAIP-2 chain identifier (e.g., "sui:mainnet")
   * @returns Total activity count
   */
  getActivityCount(chain: string): number {
    const row = this.countStmt.get(chain) as { count: number } | undefined;
    return row?.count ?? 0;
  }
}
