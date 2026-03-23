import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';
import type { ChainId } from '../core/action-types.js';

/**
 * A row from the coin_metadata table.
 */
export interface CoinMetadataRow {
  readonly coin_type: string;
  readonly chain_id: ChainId;
  readonly symbol: string;
  readonly name: string | null;
  readonly decimals: number;
}

/**
 * Repository for the coin_metadata table.
 * Uses cached prepared statements following the same pattern as ActivityLog.
 */
export class CoinMetadataRepository {
  private readonly getStmt: Statement;
  private readonly upsertStmt: Statement;
  private readonly upsertBulkTxn: Database.Transaction<(rows: readonly CoinMetadataRow[]) => void>;
  private readonly getBulkCache = new Map<number, Statement>();

  constructor(private readonly db: Database.Database) {
    this.getStmt = db.prepare(
      'SELECT coin_type, chain_id, symbol, name, decimals FROM coin_metadata WHERE coin_type = ? AND chain_id = ?',
    );

    this.upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO coin_metadata (coin_type, chain_id, symbol, name, decimals)
      VALUES (@coin_type, @chain_id, @symbol, @name, @decimals)
    `);

    this.upsertBulkTxn = db.transaction((rows: readonly CoinMetadataRow[]) => {
      for (const row of rows) {
        this.upsert(row);
      }
    });
  }

  /**
   * Get a single coin metadata row by primary key.
   */
  get(coinType: string, chain: ChainId): CoinMetadataRow | null {
    return (this.getStmt.get(coinType, chain) as CoinMetadataRow | undefined) ?? null;
  }

  /**
   * Get multiple coin metadata rows by coin types for a given chain.
   * Uses dynamic SQL since better-sqlite3 does not support array binds.
   */
  getBulk(coinTypes: readonly string[], chain: ChainId): CoinMetadataRow[] {
    if (coinTypes.length === 0) return [];

    const arity = coinTypes.length;
    let stmt = this.getBulkCache.get(arity);
    if (stmt === undefined) {
      const placeholders = coinTypes.map(() => '?').join(', ');
      stmt = this.db.prepare(
        `SELECT coin_type, chain_id, symbol, name, decimals FROM coin_metadata WHERE coin_type IN (${placeholders}) AND chain_id = ?`,
      );
      this.getBulkCache.set(arity, stmt);
    }
    return stmt.all(...coinTypes, chain) as CoinMetadataRow[];
  }

  /**
   * Insert or replace a single coin metadata row.
   */
  upsert(row: CoinMetadataRow): void {
    this.upsertStmt.run(row);
  }

  /**
   * Insert or replace multiple coin metadata rows in a single transaction.
   */
  upsertBulk(rows: readonly CoinMetadataRow[]): void {
    if (rows.length === 0) return;
    this.upsertBulkTxn(rows);
  }
}
