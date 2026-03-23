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

  `CREATE TABLE IF NOT EXISTS lending_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('supply', 'borrow', 'withdraw', 'repay', 'claim_rewards')),
    protocol TEXT NOT NULL,
    market_id TEXT,
    coin_type TEXT,
    token_symbol TEXT,
    amount TEXT,
    value_usd REAL,
    tx_digest TEXT,
    gas_cost REAL,
    policy_decision TEXT NOT NULL CHECK (policy_decision IN ('approved', 'rejected')),
    rejection_reason TEXT,
    rejection_check TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (wallet_address) REFERENCES wallets(address)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_lending_chain_created
    ON lending_activities(chain_id, created_at)`,

  `CREATE INDEX IF NOT EXISTS idx_lending_wallet
    ON lending_activities(wallet_address)`,

  `CREATE INDEX IF NOT EXISTS idx_lending_protocol_action
    ON lending_activities(protocol, action)`,

  // --- Unified activities table ---
  `CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('trade', 'lending', 'lp', 'perp', 'staking')),
    action TEXT NOT NULL CHECK (instr(action, ':') > 0 AND substr(action, 1, instr(action, ':') - 1) = category),
    protocol TEXT,
    token_a_type TEXT,
    token_a_amount TEXT,
    token_b_type TEXT,
    token_b_amount TEXT,
    value_usd REAL,
    tx_digest TEXT,
    gas_cost REAL,
    policy_decision TEXT NOT NULL CHECK (policy_decision IN ('approved', 'rejected')),
    rejection_reason TEXT,
    rejection_check TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (wallet_address) REFERENCES wallets(address)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_activities_chain_created
    ON activities(chain_id, created_at)`,

  `CREATE INDEX IF NOT EXISTS idx_activities_wallet
    ON activities(wallet_address)`,

  `CREATE INDEX IF NOT EXISTS idx_activities_category_action
    ON activities(category, action)`,

  `CREATE INDEX IF NOT EXISTS idx_activities_policy
    ON activities(policy_decision)`,

  // Migrate existing trades → activities (per-row dedup via LEFT JOIN)
  `INSERT INTO activities (
    chain_id, wallet_address, category, action, protocol,
    token_a_type, token_a_amount,
    token_b_type, token_b_amount,
    value_usd, tx_digest, gas_cost,
    policy_decision, rejection_reason, rejection_check,
    metadata, created_at
  )
  SELECT
    t.chain_id, t.wallet_address,
    CASE WHEN t.action = 'swap' THEN 'trade'
         WHEN t.action = 'supply' THEN 'lending'
         ELSE 'lp' END,
    CASE WHEN t.action = 'swap' THEN 'trade:swap'
         WHEN t.action = 'supply' THEN 'lending:supply'
         WHEN t.action = 'lp_deposit' THEN 'lp:deposit'
         WHEN t.action = 'lp_withdraw' THEN 'lp:withdraw'
         ELSE 'lp:' || t.action END,
    t.protocol,
    t.from_coin_type, t.amount_in,
    t.to_coin_type, t.amount_out,
    t.value_usd, t.tx_digest, t.gas_cost,
    t.policy_decision, t.rejection_reason, t.rejection_check,
    CASE WHEN t.pool IS NOT NULL THEN json_object('pool', t.pool) ELSE NULL END,
    t.created_at
  FROM trades t
  LEFT JOIN activities a
    ON a.tx_digest IS NOT NULL AND a.tx_digest = t.tx_digest
  WHERE a.id IS NULL`,

  // Migrate existing lending_activities → activities (per-row dedup via LEFT JOIN)
  `INSERT INTO activities (
    chain_id, wallet_address, category, action, protocol,
    token_a_type, token_a_amount,
    value_usd, tx_digest, gas_cost,
    policy_decision, rejection_reason, rejection_check,
    metadata, created_at
  )
  SELECT
    la.chain_id, la.wallet_address,
    'lending', 'lending:' || la.action, la.protocol,
    la.coin_type, la.amount,
    la.value_usd, la.tx_digest, la.gas_cost,
    la.policy_decision, la.rejection_reason, la.rejection_check,
    CASE WHEN la.market_id IS NOT NULL THEN json_object('market_id', la.market_id) ELSE NULL END,
    la.created_at
  FROM lending_activities la
  LEFT JOIN activities a
    ON a.tx_digest IS NOT NULL AND a.tx_digest = la.tx_digest
  WHERE a.id IS NULL`,

  // Drop legacy tables — data has been migrated to unified activities table
  `DROP TABLE IF EXISTS trades`,
  `DROP TABLE IF EXISTS lending_activities`,
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

    // Drop dead symbol columns from activities — symbols are resolved via
    // LEFT JOIN on coin_metadata at query time, not stored in the table.
    // Safe to re-run: silently skips if columns don't exist (fresh install
    // or already dropped).
    for (const col of ['token_a_symbol', 'token_b_symbol'] as const) {
      const exists = db
        .prepare(`SELECT 1 FROM pragma_table_info('activities') WHERE name = ?`)
        .get(col);
      if (exists !== undefined) {
        db.exec(`ALTER TABLE activities DROP COLUMN ${col}`);
      }
    }
  });

  runAll();
}
