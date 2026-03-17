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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (wallet_address) REFERENCES wallets(address)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_trades_chain_created
    ON trades(chain, created_at)`,

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

  // ALTER TABLE migration — SQLite lacks IF NOT EXISTS for columns
  try {
    db.exec('ALTER TABLE wallets ADD COLUMN is_watch_only INTEGER NOT NULL DEFAULT 0');
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('duplicate column name')) {
      // Column already exists — safe to ignore
    } else {
      throw err;
    }
  }

  // Add alias column (UNIQUE enforced via separate index — SQLite cannot ALTER TABLE ADD COLUMN with UNIQUE)
  try {
    db.exec('ALTER TABLE wallets ADD COLUMN alias TEXT');
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('duplicate column name')) {
      // Column already exists
    } else {
      throw err;
    }
  }

  // Enforce uniqueness via index
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_alias ON wallets(alias)');

  // Backfill NULL aliases with auto-generated names
  const rows = db
    .prepare('SELECT id, chain, is_watch_only FROM wallets WHERE alias IS NULL')
    .all() as { id: number; chain: string; is_watch_only: number }[];
  for (const row of rows) {
    const prefix = row.is_watch_only === 1 ? `${row.chain}-watch` : row.chain;
    const count = db
      .prepare("SELECT COUNT(*) as n FROM wallets WHERE alias LIKE ? || '-%'")
      .get(prefix) as { n: number };
    const alias = `${prefix}-${count.n + 1}`;
    db.prepare('UPDATE wallets SET alias = ? WHERE id = ?').run(alias, row.id);
  }
}
