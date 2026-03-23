import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ActivityRecord } from '../db/activity-log.js';
import { ActivityLog } from '../db/activity-log.js';
import { openMemoryDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrations.js';

function insertTestWallet(db: Database.Database, address = '0xabc'): void {
  db.prepare(
    `INSERT OR IGNORE INTO wallets (chain_id, address, is_primary) VALUES ('sui:mainnet', ?, 1)`,
  ).run(address);
}

/** Recreate legacy tables dropped by migrations, for data migration tests. */
function createLegacyTables(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id TEXT NOT NULL, wallet_address TEXT NOT NULL,
    action TEXT NOT NULL, protocol TEXT, pool TEXT,
    from_token TEXT NOT NULL, to_token TEXT NOT NULL,
    amount_in TEXT NOT NULL, amount_out TEXT,
    value_usd REAL, tx_digest TEXT, gas_cost REAL,
    policy_decision TEXT NOT NULL, rejection_reason TEXT, rejection_check TEXT,
    from_coin_type TEXT, to_coin_type TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (wallet_address) REFERENCES wallets(address)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS lending_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id TEXT NOT NULL, wallet_address TEXT NOT NULL,
    action TEXT NOT NULL, protocol TEXT NOT NULL,
    market_id TEXT, coin_type TEXT, token_symbol TEXT, amount TEXT,
    value_usd REAL, tx_digest TEXT, gas_cost REAL,
    policy_decision TEXT NOT NULL, rejection_reason TEXT, rejection_check TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (wallet_address) REFERENCES wallets(address)
  )`);
}

describe('ActivityLog', () => {
  let db: Database.Database;
  let log: ActivityLog;

  beforeEach(() => {
    db = openMemoryDatabase();
    log = new ActivityLog(db);
    insertTestWallet(db);
  });

  describe('logActivity', () => {
    it('inserts a swap activity and returns row ID', () => {
      const record: ActivityRecord = {
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        protocol: '7k',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100000000',
        token_b_type: '0xusdc::usdc::USDC',
        token_b_amount: '98120000',
        value_usd: 98.0,
        tx_digest: '0xdigest123',
        gas_cost: 0.0021,
        policy_decision: 'approved',
      };
      const id = log.logActivity(record);
      expect(id).toBeGreaterThan(0);
    });

    it('inserts a lending supply activity', () => {
      const record: ActivityRecord = {
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'lending:supply',
        protocol: 'alphalend',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '1000000000',
        value_usd: 100.0,
        tx_digest: '0xdigest456',
        gas_cost: 0.002,
        policy_decision: 'approved',
        metadata: { market_id: '1' },
      };
      const id = log.logActivity(record);
      expect(id).toBeGreaterThan(0);
    });

    it('inserts a claim_rewards activity with no token fields', () => {
      const record: ActivityRecord = {
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'lending:claim_rewards',
        protocol: 'alphalend',
        policy_decision: 'approved',
        tx_digest: '0xdigest789',
        gas_cost: 0.001,
      };
      const id = log.logActivity(record);
      expect(id).toBeGreaterThan(0);
    });
  });

  describe('getRolling24hVolume', () => {
    it('sums approved swap volume in last 24h', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        value_usd: 50.0,
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
      });
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        value_usd: 30.0,
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '60',
      });
      expect(log.getRolling24hVolume('sui:mainnet' as any)).toBe(80.0);
    });

    it('excludes rejected and non-swap activities', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        value_usd: 50.0,
        policy_decision: 'rejected',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
      });
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'lending:supply',
        value_usd: 100.0,
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '200',
      });
      expect(log.getRolling24hVolume('sui:mainnet' as any)).toBe(0);
    });
  });

  describe('getRecentActivities', () => {
    it('returns activities ordered by most recent first', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
      });
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'lending:supply',
        protocol: 'alphalend',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '200',
      });
      const rows = log.getRecentActivities('sui:mainnet', 10);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.category).toBe('lending'); // most recent
      expect(rows[1]!.category).toBe('trade');
    });
  });

  describe('getRecentByCategory', () => {
    it('filters by category', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
      });
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'lending:supply',
        protocol: 'alphalend',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '200',
      });
      const swaps = log.getRecentByCategory('sui:mainnet', 'trade', 10);
      expect(swaps).toHaveLength(1);
      expect(swaps[0]!.action).toBe('trade:swap');
    });
  });

  describe('metadata', () => {
    it('round-trips JSON metadata', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'lending:supply',
        protocol: 'alphalend',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
        metadata: { market_id: '1', extra: true },
      });
      const rows = log.getRecentActivities('sui:mainnet', 1);
      expect(rows).toHaveLength(1);
      const parsed = JSON.parse(rows[0]!.metadata!);
      expect(parsed.market_id).toBe('1');
      expect(parsed.extra).toBe(true);
    });

    it('stores null when no metadata provided', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
      });
      const rows = log.getRecentActivities('sui:mainnet', 1);
      expect(rows[0]!.metadata).toBeNull();
    });

    it('round-trips nested JSON metadata', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'lending:supply',
        protocol: 'alphalend',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
        metadata: { market_id: '1', nested: { a: [1, 2, 3] } },
      });
      const rows = log.getRecentActivities('sui:mainnet', 1);
      const parsed = JSON.parse(rows[0]!.metadata!);
      expect(parsed.nested.a).toEqual([1, 2, 3]);
    });
  });

  describe('getActivityCount', () => {
    it('returns 0 when no activities exist', () => {
      expect(log.getActivityCount('sui:mainnet')).toBe(0);
    });

    it('counts all activities for a chain', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
      });
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'lending:supply',
        protocol: 'alphalend',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '200',
      });
      expect(log.getActivityCount('sui:mainnet')).toBe(2);
    });

    it('isolates counts by chain_id', () => {
      insertTestWallet(db, '0xdef');
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
      });
      log.logActivity({
        chain_id: 'sui:testnet',
        wallet_address: '0xdef',
        action: 'trade:swap',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
      });
      expect(log.getActivityCount('sui:mainnet')).toBe(1);
      expect(log.getActivityCount('sui:testnet')).toBe(1);
    });
  });

  describe('getActivityCountByCategory', () => {
    it('returns 0 when no activities match category', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
      });
      expect(log.getActivityCountByCategory('sui:mainnet', 'lending')).toBe(0);
    });

    it('counts activities filtered by category', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
      });
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'lending:supply',
        protocol: 'alphalend',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '200',
      });
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'lending:borrow',
        protocol: 'alphalend',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '300',
      });
      expect(log.getActivityCountByCategory('sui:mainnet', 'trade')).toBe(1);
      expect(log.getActivityCountByCategory('sui:mainnet', 'lending')).toBe(2);
    });
  });

  describe('pagination', () => {
    it('getRecentActivities respects limit and offset', () => {
      for (let i = 0; i < 5; i++) {
        log.logActivity({
          chain_id: 'sui:mainnet',
          wallet_address: '0xabc',
          action: 'trade:swap',
          policy_decision: 'approved',
          token_a_type: '0x2::sui::SUI',
          token_a_amount: String(i),
        });
      }
      const page1 = log.getRecentActivities('sui:mainnet', 2, 0);
      const page2 = log.getRecentActivities('sui:mainnet', 2, 2);
      const page3 = log.getRecentActivities('sui:mainnet', 2, 4);
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page3).toHaveLength(1);
      const allIds = [...page1, ...page2, ...page3].map((r) => r.id);
      expect(new Set(allIds).size).toBe(5);
    });

    it('getRecentByCategory respects limit and offset', () => {
      for (let i = 0; i < 3; i++) {
        log.logActivity({
          chain_id: 'sui:mainnet',
          wallet_address: '0xabc',
          action: 'trade:swap',
          policy_decision: 'approved',
          token_a_type: '0x2::sui::SUI',
          token_a_amount: String(i),
        });
      }
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'lending:supply',
        protocol: 'alphalend',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '999',
      });
      const page1 = log.getRecentByCategory('sui:mainnet', 'trade', 2, 0);
      const page2 = log.getRecentByCategory('sui:mainnet', 'trade', 2, 2);
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
    });
  });

  describe('rejection fields', () => {
    it('stores rejection_reason and rejection_check', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        policy_decision: 'rejected',
        rejection_reason: 'Exceeds 24h spending limit',
        rejection_check: 'SpendingLimitCheck',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
        value_usd: 5000.0,
      });
      const rows = log.getRecentActivities('sui:mainnet', 1);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.policy_decision).toBe('rejected');
      expect(rows[0]!.rejection_reason).toBe('Exceeds 24h spending limit');
      expect(rows[0]!.rejection_check).toBe('SpendingLimitCheck');
    });

    it('stores null for rejection fields on approved activities', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
      });
      const rows = log.getRecentActivities('sui:mainnet', 1);
      expect(rows[0]!.rejection_reason).toBeNull();
      expect(rows[0]!.rejection_check).toBeNull();
    });
  });

  describe('full ActivityRow shape', () => {
    it('returns all fields with correct types', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        protocol: '7k',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100000000',
        token_b_type: '0xusdc::usdc::USDC',
        token_b_amount: '98120000',
        value_usd: 98.0,
        tx_digest: '0xdigest123',
        gas_cost: 0.0021,
        policy_decision: 'approved',
        metadata: { route: 'direct' },
      });
      const rows = log.getRecentActivities('sui:mainnet', 1);
      const row = rows[0]!;
      expect(typeof row.id).toBe('number');
      expect(row.chain_id).toBe('sui:mainnet');
      expect(row.wallet_address).toBe('0xabc');
      expect(row.category).toBe('trade');
      expect(row.action).toBe('trade:swap');
      expect(row.protocol).toBe('7k');
      expect(row.token_a_type).toBe('0x2::sui::SUI');
      expect(row.token_a_symbol).toBeNull();
      expect(row.token_a_decimals).toBeNull();
      expect(row.token_a_amount).toBe('100000000');
      expect(row.token_b_type).toBe('0xusdc::usdc::USDC');
      expect(row.token_b_symbol).toBeNull();
      expect(row.token_b_decimals).toBeNull();
      expect(row.token_b_amount).toBe('98120000');
      expect(row.value_usd).toBe(98.0);
      expect(row.tx_digest).toBe('0xdigest123');
      expect(row.gas_cost).toBe(0.0021);
      expect(row.policy_decision).toBe('approved');
      expect(row.rejection_reason).toBeNull();
      expect(row.rejection_check).toBeNull();
      expect(typeof row.created_at).toBe('string');
      expect(JSON.parse(row.metadata!)).toEqual({ route: 'direct' });
    });

    it('returns null for all optional fields when not provided', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'lending:claim_rewards',
        protocol: 'alphalend',
        policy_decision: 'approved',
      });
      const row = log.getRecentActivities('sui:mainnet', 1)[0]!;
      expect(row.token_a_type).toBeNull();
      expect(row.token_a_symbol).toBeNull();
      expect(row.token_a_amount).toBeNull();
      expect(row.token_b_type).toBeNull();
      expect(row.token_b_symbol).toBeNull();
      expect(row.token_b_amount).toBeNull();
      expect(row.value_usd).toBeNull();
      expect(row.tx_digest).toBeNull();
      expect(row.gas_cost).toBeNull();
      expect(row.metadata).toBeNull();
    });
  });

  describe('empty results', () => {
    it('getRecentActivities returns empty array for unknown chain', () => {
      expect(log.getRecentActivities('eip155:1', 10)).toEqual([]);
    });

    it('getRecentByCategory returns empty array when no match', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
      });
      expect(log.getRecentByCategory('sui:mainnet', 'staking', 10)).toEqual([]);
    });

    it('getRolling24hVolume returns 0 for unknown chain', () => {
      expect(log.getRolling24hVolume('eip155:1' as any)).toBe(0);
    });
  });

  describe('logActivity incremental IDs', () => {
    it('returns incrementing row IDs', () => {
      const id1 = log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
      });
      const id2 = log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '200',
      });
      expect(id2).toBe(id1 + 1);
    });
  });

  describe('policy_decision constraint', () => {
    it('rejects invalid policy_decision values', () => {
      expect(() => {
        log.logActivity({
          chain_id: 'sui:mainnet',
          wallet_address: '0xabc',
          action: 'trade:swap',
          policy_decision: 'maybe' as any,
          token_a_type: '0x2::sui::SUI',
          token_a_amount: '100',
        });
      }).toThrow();
    });
  });

  describe('getRolling24hVolume edge cases', () => {
    it('handles null value_usd by treating as 0', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
      });
      expect(log.getRolling24hVolume('sui:mainnet' as any)).toBe(0);
    });

    it('sums only within last 24h window', () => {
      log.logActivity({
        chain_id: 'sui:mainnet',
        wallet_address: '0xabc',
        action: 'trade:swap',
        policy_decision: 'approved',
        token_a_type: '0x2::sui::SUI',
        token_a_amount: '100',
        value_usd: 50.0,
      });
      db.prepare(
        `
        INSERT INTO activities (chain_id, wallet_address, category, action,
          token_a_type, token_a_amount, value_usd, policy_decision, created_at)
        VALUES ('sui:mainnet', '0xabc', 'trade', 'trade:swap',
          '0x2::sui::SUI', '100', 200.0, 'approved', datetime('now', '-25 hours'))
      `,
      ).run();
      expect(log.getRolling24hVolume('sui:mainnet' as any)).toBe(50.0);
    });
  });

  describe('data migration', () => {
    it('migrates trades to activities with correct field mapping', () => {
      createLegacyTables(db);
      db.prepare(
        `
        INSERT INTO trades (chain_id, wallet_address, action, protocol, pool,
          from_token, to_token, amount_in, amount_out,
          from_coin_type, to_coin_type,
          value_usd, tx_digest, gas_cost, policy_decision)
        VALUES ('sui:mainnet', '0xabc', 'swap', '7k', NULL,
          'SUI', 'USDC', '100000000', '98120000',
          '0x2::sui::SUI', '0xusdc::usdc::USDC',
          98.0, '0xolddigest', 0.002, 'approved')
      `,
      ).run();
      db.exec('DELETE FROM activities');
      runMigrations(db);
      const rows = log.getRecentActivities('sui:mainnet', 10);
      const migrated = rows.find((r) => r.tx_digest === '0xolddigest');
      expect(migrated).toBeDefined();
      expect(migrated!.category).toBe('trade');
      expect(migrated!.action).toBe('trade:swap');
      expect(migrated!.token_a_symbol).toBeNull();
      expect(migrated!.token_b_symbol).toBeNull();
      expect(migrated!.token_a_amount).toBe('100000000');
      expect(migrated!.token_b_amount).toBe('98120000');
      expect(migrated!.token_a_type).toBe('0x2::sui::SUI');
      expect(migrated!.token_b_type).toBe('0xusdc::usdc::USDC');
      expect(migrated!.value_usd).toBe(98.0);
      expect(migrated!.protocol).toBe('7k');
      expect(migrated!.metadata).toBeNull();
    });

    it('migrates trades with pool into metadata', () => {
      createLegacyTables(db);
      db.prepare(
        `
        INSERT INTO trades (chain_id, wallet_address, action, protocol, pool,
          from_token, to_token, amount_in,
          from_coin_type, to_coin_type,
          policy_decision)
        VALUES ('sui:mainnet', '0xabc', 'lp_deposit', 'cetus', 'pool-abc',
          'SUI', 'USDC', '100000000',
          '0x2::sui::SUI', '0xusdc::usdc::USDC',
          'approved')
      `,
      ).run();
      db.exec('DELETE FROM activities');
      runMigrations(db);
      const rows = log.getRecentActivities('sui:mainnet', 10);
      const migrated = rows.find((r) => r.action === 'lp:deposit');
      expect(migrated).toBeDefined();
      expect(migrated!.category).toBe('lp');
      const meta = JSON.parse(migrated!.metadata!);
      expect(meta.pool).toBe('pool-abc');
    });

    it('migrates lending_activities to activities with correct field mapping', () => {
      createLegacyTables(db);
      db.prepare(
        `
        INSERT INTO lending_activities (chain_id, wallet_address, action, protocol,
          market_id, coin_type, token_symbol, amount,
          value_usd, tx_digest, gas_cost, policy_decision)
        VALUES ('sui:mainnet', '0xabc', 'supply', 'alphalend',
          '1', '0x2::sui::SUI', 'SUI', '1000000000',
          100.0, '0xlenddigest', 0.002, 'approved')
      `,
      ).run();
      db.exec('DELETE FROM activities');
      runMigrations(db);
      const rows = log.getRecentByCategory('sui:mainnet', 'lending', 10);
      const migrated = rows.find((r) => r.tx_digest === '0xlenddigest');
      expect(migrated).toBeDefined();
      expect(migrated!.category).toBe('lending');
      expect(migrated!.action).toBe('lending:supply');
      expect(migrated!.protocol).toBe('alphalend');
      expect(migrated!.token_a_type).toBe('0x2::sui::SUI');
      expect(migrated!.token_a_symbol).toBeNull();
      expect(migrated!.token_a_amount).toBe('1000000000');
      expect(migrated!.value_usd).toBe(100.0);
      const meta = JSON.parse(migrated!.metadata!);
      expect(meta.market_id).toBe('1');
    });
  });
});
