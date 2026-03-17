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
  /** Fully-qualified on-chain coin type for fromToken (e.g., "0x2::sui::SUI") */
  readonly from_coin_type?: string;
  /** Fully-qualified on-chain coin type for toToken */
  readonly to_coin_type?: string;
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
  readonly from_coin_type: string | null;
  readonly to_coin_type: string | null;
  readonly created_at: string;
}

/**
 * Trade log with cached prepared SQL statements for performance.
 *
 * This is the sole API for trade data access. Caching prepared statements
 * avoids re-parsing SQL on every call, which matters for hot paths
 * (e.g., policy checks during swap evaluation, TUI polling).
 */
export class TradeLog {
  private readonly insertStmt: Statement;
  private readonly rolling24hStmt: Statement;
  private readonly recentStmt: Statement;
  private readonly countStmt: Statement;

  constructor(db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO trades (
        chain, wallet_address, action, protocol, pool,
        from_token, to_token, amount_in, amount_out,
        value_usd, tx_digest, gas_cost,
        policy_decision, rejection_reason, rejection_check,
        from_coin_type, to_coin_type
      ) VALUES (
        @chain, @wallet_address, @action, @protocol, @pool,
        @from_token, @to_token, @amount_in, @amount_out,
        @value_usd, @tx_digest, @gas_cost,
        @policy_decision, @rejection_reason, @rejection_check,
        @from_coin_type, @to_coin_type
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
      LIMIT ? OFFSET ?
    `);

    this.countStmt = db.prepare(`
      SELECT COUNT(*) as count FROM trades WHERE chain = ?
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
      from_coin_type: trade.from_coin_type ?? null,
      to_coin_type: trade.to_coin_type ?? null,
    });

    return Number(result.lastInsertRowid);
  }

  /**
   * Get the rolling 24-hour approved trade volume in USD for a given chain.
   *
   * @param chain - CAIP-2 chain identifier (e.g., "sui:mainnet")
   * @returns Total USD volume of approved trades in the last 24 hours (0 if none)
   */
  getRolling24hVolume(chain: string): number {
    const row = this.rolling24hStmt.get(chain) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  /**
   * Get recent trades for a given chain, ordered by most recent first.
   *
   * @param chain - CAIP-2 chain identifier (e.g., "sui:mainnet")
   * @param limit - Maximum number of trades to return
   * @param offset - Number of trades to skip (for pagination)
   * @returns Array of trade rows
   */
  getRecentTrades(chain: string, limit: number, offset = 0): TradeRow[] {
    return this.recentStmt.all(chain, limit, offset) as TradeRow[];
  }

  /**
   * Get the total number of trades for a given chain.
   *
   * @param chain - CAIP-2 chain identifier (e.g., "sui:mainnet")
   * @returns Total trade count
   */
  getTradeCount(chain: string): number {
    const row = this.countStmt.get(chain) as { count: number } | undefined;
    return row?.count ?? 0;
  }
}
