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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

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

  // Add from_coin_type / to_coin_type to trades (added after initial schema)
  for (const col of ['from_coin_type', 'to_coin_type']) {
    try {
      db.exec(`ALTER TABLE trades ADD COLUMN ${col} TEXT`);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('duplicate column name')) {
        // Column already exists
      } else {
        throw err;
      }
    }
  }

  // Rename 'chain' → 'chain_id' in all tables (SQLite >= 3.25.0)
  for (const table of ['wallets', 'trades', 'coin_metadata'] as const) {
    try {
      db.exec(`ALTER TABLE ${table} RENAME COLUMN chain TO chain_id`);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('no such column')) {
        // Column already renamed or was created as chain_id
      } else {
        throw err;
      }
    }
  }

  // Drop old index and recreate with chain_id (idempotent)
  db.exec('DROP INDEX IF EXISTS idx_trades_chain_created');
  db.exec('CREATE INDEX IF NOT EXISTS idx_trades_chain_id_created ON trades(chain_id, created_at)');

  // Enforce uniqueness via index
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_alias ON wallets(alias)');

  // Backfill NULL aliases with auto-generated names
  const rows = db
    .prepare('SELECT id, chain_id, is_watch_only FROM wallets WHERE alias IS NULL')
    .all() as { id: number; chain_id: string; is_watch_only: number }[];
  for (const row of rows) {
    const prefix = row.is_watch_only === 1 ? `${row.chain_id}-watch` : row.chain_id;
    const count = db
      .prepare("SELECT COUNT(*) as n FROM wallets WHERE alias LIKE ? || '-%'")
      .get(prefix) as { n: number };
    const alias = `${prefix}-${count.n + 1}`;
    db.prepare('UPDATE wallets SET alias = ? WHERE id = ?').run(alias, row.id);
  }

  // Normalize chain values from short aliases to CAIP-2 format.
  // Earlier versions stored 'sui' instead of 'sui:mainnet'.
  const CHAIN_ALIAS_TO_CAIP2: Record<string, string> = {
    sui: 'sui:mainnet',
  };

  for (const [alias, caip2] of Object.entries(CHAIN_ALIAS_TO_CAIP2)) {
    db.prepare('UPDATE wallets SET chain_id = ? WHERE chain_id = ?').run(caip2, alias);
    db.prepare('UPDATE trades SET chain_id = ? WHERE chain_id = ?').run(caip2, alias);
    db.prepare('UPDATE coin_metadata SET chain_id = ? WHERE chain_id = ?').run(caip2, alias);
  }
}
