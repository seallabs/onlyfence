import type Database from 'better-sqlite3';

/**
 * SQL statements for creating the OnlyFence database schema.
 * Each migration is idempotent (uses IF NOT EXISTS).
 *
 * Chain values use CAIP-2 format (e.g., "sui:mainnet", "eip155:1").
 * Token coin types are fully-qualified on-chain identifiers
 * (e.g., "0x2::sui::SUI" for Sui Move coin types).
 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id TEXT NOT NULL,
    address TEXT NOT NULL UNIQUE,
    derivation_path TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0,
    is_watch_only INTEGER NOT NULL DEFAULT 0,
    alias TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_alias
    ON wallets(alias)`,

  `CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('swap', 'supply', 'lp_deposit', 'lp_withdraw')),
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
    from_coin_type TEXT,
    to_coin_type TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (wallet_address) REFERENCES wallets(address)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_trades_chain_id_created
    ON trades(chain_id, created_at)`,

  `CREATE INDEX IF NOT EXISTS idx_trades_wallet_address
    ON trades(wallet_address)`,

  `CREATE INDEX IF NOT EXISTS idx_trades_policy_decision
    ON trades(policy_decision)`,

  `CREATE TABLE IF NOT EXISTS cli_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command TEXT NOT NULL,
    success INTEGER NOT NULL CHECK (success IN (0, 1)),
    duration_ms INTEGER NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cli_events_created
    ON cli_events(created_at)`,

  `CREATE INDEX IF NOT EXISTS idx_cli_events_command_created
    ON cli_events(command, created_at)`,

  `CREATE TABLE IF NOT EXISTS coin_metadata (
    coin_type   TEXT    NOT NULL,
    chain_id    TEXT    NOT NULL,
    symbol      TEXT    NOT NULL,
    name        TEXT,
    decimals    INTEGER NOT NULL,
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (coin_type, chain_id)
  )`,
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
