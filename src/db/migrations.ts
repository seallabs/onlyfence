import type Database from 'better-sqlite3';

/**
 * SQL statements for creating the OnlyFence database schema.
 * Each migration is idempotent (uses IF NOT EXISTS).
 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain TEXT NOT NULL,
    address TEXT NOT NULL UNIQUE,
    derivation_path TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('swap', 'lp_deposit', 'lp_withdraw')),
    protocol TEXT,
    pool TEXT,
    from_token TEXT NOT NULL,
    to_token TEXT NOT NULL,
    amount_in TEXT NOT NULL,
    amount_out TEXT,
    value_usd REAL,
    tx_digest TEXT,
    gas_cost REAL,
    policy_decision TEXT NOT NULL CHECK (policy_decision IN ('approved', 'rejected')),
    rejection_reason TEXT,
    rejection_check TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (wallet_address) REFERENCES wallets(address)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_trades_chain_created
    ON trades(chain, created_at)`,

  `CREATE INDEX IF NOT EXISTS idx_trades_wallet_address
    ON trades(wallet_address)`,

  `CREATE INDEX IF NOT EXISTS idx_trades_policy_decision
    ON trades(policy_decision)`,
];

/**
 * Run all database migrations to ensure the schema is up to date.
 *
 * @param db - The SQLite database connection
 * @throws Error if any migration fails
 */
export function runMigrations(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const runAll = db.transaction(() => {
    for (const sql of MIGRATIONS) {
      db.exec(sql);
    }
  });

  runAll();
}
