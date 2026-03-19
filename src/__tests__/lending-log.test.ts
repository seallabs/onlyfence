import { describe, it, expect, beforeEach } from 'vitest';
import { openMemoryDatabase } from '../db/connection.js';
import { LendingLog } from '../db/lending-log.js';
import { createLendingRecord, insertTestWallet } from './helpers.js';
import type Database from 'better-sqlite3';

describe('LendingLog', () => {
  let db: Database.Database;
  let lendingLog: LendingLog;

  beforeEach(() => {
    db = openMemoryDatabase();
    lendingLog = new LendingLog(db);
    insertTestWallet(db, '0xabc');
  });

  describe('logActivity', () => {
    it('should insert an activity and return the row ID', () => {
      const id = lendingLog.logActivity(createLendingRecord());
      expect(id).toBe(1);

      const id2 = lendingLog.logActivity(createLendingRecord({ tx_digest: '0xdigest456' }));
      expect(id2).toBe(2);
    });

    it('should handle nullable fields for claim_rewards', () => {
      const id = lendingLog.logActivity(
        createLendingRecord({
          action: 'claim_rewards',
          coin_type: undefined,
          token_symbol: undefined,
          amount: undefined,
          market_id: undefined,
          value_usd: undefined,
        }),
      );
      expect(id).toBe(1);

      const rows = lendingLog.getRecentActivities('sui:mainnet', 10);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.coin_type).toBeNull();
      expect(rows[0]?.token_symbol).toBeNull();
      expect(rows[0]?.amount).toBeNull();
      expect(rows[0]?.market_id).toBeNull();
      expect(rows[0]?.value_usd).toBeNull();
    });
  });

  describe('getRecentActivities', () => {
    it('should return empty array when no activities exist', () => {
      const activities = lendingLog.getRecentActivities('sui:mainnet', 10);
      expect(activities).toHaveLength(0);
    });

    it('should return activities ordered by most recent first', () => {
      lendingLog.logActivity(createLendingRecord({ action: 'supply', amount: '100' }));
      lendingLog.logActivity(createLendingRecord({ action: 'borrow', amount: '200' }));

      const activities = lendingLog.getRecentActivities('sui:mainnet', 10);
      expect(activities).toHaveLength(2);
      // Most recent first (higher ID = later insert)
      expect(activities[0]?.action).toBe('borrow');
      expect(activities[1]?.action).toBe('supply');
    });

    it('should respect the limit parameter', () => {
      lendingLog.logActivity(createLendingRecord({ amount: '100' }));
      lendingLog.logActivity(createLendingRecord({ amount: '200' }));
      lendingLog.logActivity(createLendingRecord({ amount: '300' }));

      const activities = lendingLog.getRecentActivities('sui:mainnet', 2);
      expect(activities).toHaveLength(2);
    });

    it('should support offset for pagination', () => {
      lendingLog.logActivity(createLendingRecord({ action: 'supply', amount: '100' }));
      lendingLog.logActivity(createLendingRecord({ action: 'borrow', amount: '200' }));
      lendingLog.logActivity(createLendingRecord({ action: 'withdraw', amount: '300' }));

      // Most recent first: withdraw, borrow, supply — skip first, get next 2
      const activities = lendingLog.getRecentActivities('sui:mainnet', 2, 1);
      expect(activities).toHaveLength(2);
      expect(activities[0]?.action).toBe('borrow');
      expect(activities[1]?.action).toBe('supply');
    });

    it('should filter by chain', () => {
      lendingLog.logActivity(createLendingRecord({ chain_id: 'sui:mainnet' }));
      lendingLog.logActivity(createLendingRecord({ chain_id: 'evm' }));

      const suiActivities = lendingLog.getRecentActivities('sui:mainnet', 10);
      expect(suiActivities).toHaveLength(1);
      expect(suiActivities[0]?.chain_id).toBe('sui:mainnet');
    });
  });

  describe('getActivityCount', () => {
    it('should return 0 when no activities exist', () => {
      expect(lendingLog.getActivityCount('sui:mainnet')).toBe(0);
    });

    it('should count all activities for a chain', () => {
      lendingLog.logActivity(createLendingRecord());
      lendingLog.logActivity(createLendingRecord({ tx_digest: '0x2' }));
      lendingLog.logActivity(createLendingRecord({ chain_id: 'evm', tx_digest: '0x3' }));

      expect(lendingLog.getActivityCount('sui:mainnet')).toBe(2);
      expect(lendingLog.getActivityCount('evm')).toBe(1);
    });
  });
});
