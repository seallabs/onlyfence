import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';

/**
 * Represents a trade record to be inserted into the database.
 */
export interface TradeRecord {
  readonly chain: string;
  readonly wallet_address: string;
  readonly action: 'swap' | 'lp_deposit' | 'lp_withdraw';
  readonly protocol?: string;
  readonly pool?: string;
  readonly from_token: string;
  readonly to_token: string;
  readonly amount_in: string;
  readonly amount_out?: string;
  readonly value_usd?: number;
  readonly tx_digest?: string;
  readonly gas_cost?: number;
  readonly policy_decision: 'approved' | 'rejected';
  readonly rejection_reason?: string;
  readonly rejection_check?: string;
}

/**
 * Represents a trade row retrieved from the database.
 */
export interface TradeRow {
  readonly id: number;
  readonly chain: string;
  readonly wallet_address: string;
  readonly action: string;
  readonly protocol: string | null;
  readonly pool: string | null;
  readonly from_token: string;
  readonly to_token: string;
  readonly amount_in: string;
  readonly amount_out: string | null;
  readonly value_usd: number | null;
  readonly tx_digest: string | null;
  readonly gas_cost: number | null;
  readonly policy_decision: string;
  readonly rejection_reason: string | null;
  readonly rejection_check: string | null;
  readonly created_at: string;
}

/**
 * Trade log with cached prepared SQL statements for hot-path performance.
 *
 * Preferred over the free functions when the same database connection
 * is used across many calls (e.g., inside a long-running process).
 */
export class TradeLog {
  private readonly insertStmt: Statement;
  private readonly rolling24hStmt: Statement;
  private readonly recentStmt: Statement;

  constructor(db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO trades (
        chain, wallet_address, action, protocol, pool,
        from_token, to_token, amount_in, amount_out,
        value_usd, tx_digest, gas_cost,
        policy_decision, rejection_reason, rejection_check
      ) VALUES (
        @chain, @wallet_address, @action, @protocol, @pool,
        @from_token, @to_token, @amount_in, @amount_out,
        @value_usd, @tx_digest, @gas_cost,
        @policy_decision, @rejection_reason, @rejection_check
      )
    `);

    // Rows with NULL value_usd are intentionally excluded from the sum:
    // COALESCE(SUM(value_usd), 0) skips NULLs, so trades where the oracle
    // price was unavailable do not count toward the 24h volume.
    this.rolling24hStmt = db.prepare(`
      SELECT COALESCE(SUM(value_usd), 0) as total
      FROM trades
      WHERE chain = ?
        AND created_at > datetime('now', '-24 hours')
        AND policy_decision = 'approved'
    `);

    this.recentStmt = db.prepare(`
      SELECT * FROM trades
      WHERE chain = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
  }

  /**
   * Insert a trade record into the database.
   *
   * @param trade - Trade record to insert
   * @returns The inserted row ID
   */
  logTrade(trade: TradeRecord): number {
    const result = this.insertStmt.run({
      chain: trade.chain,
      wallet_address: trade.wallet_address,
      action: trade.action,
      protocol: trade.protocol ?? null,
      pool: trade.pool ?? null,
      from_token: trade.from_token,
      to_token: trade.to_token,
      amount_in: trade.amount_in,
      amount_out: trade.amount_out ?? null,
      value_usd: trade.value_usd ?? null,
      tx_digest: trade.tx_digest ?? null,
      gas_cost: trade.gas_cost ?? null,
      policy_decision: trade.policy_decision,
      rejection_reason: trade.rejection_reason ?? null,
      rejection_check: trade.rejection_check ?? null,
    });

    return Number(result.lastInsertRowid);
  }

  /**
   * Get the rolling 24-hour approved trade volume in USD for a given chain.
   *
   * @param chain - Chain identifier (e.g., "sui")
   * @returns Total USD volume of approved trades in the last 24 hours (0 if none)
   */
  getRolling24hVolume(chain: string): number {
    const row = this.rolling24hStmt.get(chain) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  /**
   * Get recent trades for a given chain, ordered by most recent first.
   *
   * @param chain - Chain identifier (e.g., "sui")
   * @param limit - Maximum number of trades to return
   * @returns Array of trade rows
   */
  getRecentTrades(chain: string, limit: number): TradeRow[] {
    return this.recentStmt.all(chain, limit) as TradeRow[];
  }
}

/**
 * Insert a trade record into the database.
 *
 * Note: For hot paths with many calls on the same connection, prefer the
 * `TradeLog` class which caches prepared statements.
 *
 * @param db - SQLite database connection
 * @param trade - Trade record to insert
 * @returns The inserted row ID
 */
export function logTrade(db: Database.Database, trade: TradeRecord): number {
  const stmt = db.prepare(`
    INSERT INTO trades (
      chain, wallet_address, action, protocol, pool,
      from_token, to_token, amount_in, amount_out,
      value_usd, tx_digest, gas_cost,
      policy_decision, rejection_reason, rejection_check
    ) VALUES (
      @chain, @wallet_address, @action, @protocol, @pool,
      @from_token, @to_token, @amount_in, @amount_out,
      @value_usd, @tx_digest, @gas_cost,
      @policy_decision, @rejection_reason, @rejection_check
    )
  `);

  const result = stmt.run({
    chain: trade.chain,
    wallet_address: trade.wallet_address,
    action: trade.action,
    protocol: trade.protocol ?? null,
    pool: trade.pool ?? null,
    from_token: trade.from_token,
    to_token: trade.to_token,
    amount_in: trade.amount_in,
    amount_out: trade.amount_out ?? null,
    value_usd: trade.value_usd ?? null,
    tx_digest: trade.tx_digest ?? null,
    gas_cost: trade.gas_cost ?? null,
    policy_decision: trade.policy_decision,
    rejection_reason: trade.rejection_reason ?? null,
    rejection_check: trade.rejection_check ?? null,
  });

  return Number(result.lastInsertRowid);
}

/**
 * Get the rolling 24-hour approved trade volume in USD for a given chain.
 *
 * Note: For hot paths with many calls on the same connection, prefer the
 * `TradeLog` class which caches prepared statements.
 *
 * @param db - SQLite database connection
 * @param chain - Chain identifier (e.g., "sui")
 * @returns Total USD volume of approved trades in the last 24 hours (0 if none)
 */
export function getRolling24hVolume(db: Database.Database, chain: string): number {
  // Rows with NULL value_usd are intentionally excluded from the sum:
  // COALESCE(SUM(value_usd), 0) skips NULLs, so trades where the oracle
  // price was unavailable do not count toward the 24h volume.
  const stmt = db.prepare(`
    SELECT COALESCE(SUM(value_usd), 0) as total
    FROM trades
    WHERE chain = ?
      AND created_at > datetime('now', '-24 hours')
      AND policy_decision = 'approved'
  `);

  const row = stmt.get(chain) as { total: number } | undefined;
  return row?.total ?? 0;
}

/**
 * Get recent trades for a given chain, ordered by most recent first.
 *
 * Note: For hot paths with many calls on the same connection, prefer the
 * `TradeLog` class which caches prepared statements.
 *
 * @param db - SQLite database connection
 * @param chain - Chain identifier (e.g., "sui")
 * @param limit - Maximum number of trades to return
 * @returns Array of trade rows
 */
export function getRecentTrades(db: Database.Database, chain: string, limit: number): TradeRow[] {
  const stmt = db.prepare(`
    SELECT * FROM trades
    WHERE chain = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  return stmt.all(chain, limit) as TradeRow[];
}
