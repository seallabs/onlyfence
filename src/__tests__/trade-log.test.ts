import { describe, it, expect, beforeEach } from 'vitest';
import { openMemoryDatabase } from '../db/connection.js';
import { logTrade, getRolling24hVolume, getRecentTrades } from '../db/trade-log.js';
import { createTradeRecord, insertTestWallet } from './helpers.js';
import type Database from 'better-sqlite3';

describe('Trade Logger', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openMemoryDatabase();
    insertTestWallet(db, '0xabc');
  });

  describe('logTrade', () => {
    it('should insert a trade and return the row ID', () => {
      const id = logTrade(db, createTradeRecord());
      expect(id).toBe(1);

      const id2 = logTrade(db, createTradeRecord({ tx_digest: '0xdigest456' }));
      expect(id2).toBe(2);
    });

    it('should handle null value_usd correctly', () => {
      const id = logTrade(db, createTradeRecord({ value_usd: undefined }));
      expect(id).toBe(1);

      const rows = getRecentTrades(db, 'sui', 10);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.value_usd).toBeNull();
    });

    it('should handle optional fields as null', () => {
      const id = logTrade(db, {
        chain: 'sui',
        wallet_address: '0xabc',
        action: 'swap',
        from_token: 'SUI',
        to_token: 'USDC',
        amount_in: '100',
        policy_decision: 'rejected',
        rejection_reason: 'test_rejection',
        rejection_check: 'test_check',
      });
      expect(id).toBe(1);

      const rows = getRecentTrades(db, 'sui', 10);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.protocol).toBeNull();
      expect(rows[0]?.pool).toBeNull();
      expect(rows[0]?.amount_out).toBeNull();
      expect(rows[0]?.tx_digest).toBeNull();
      expect(rows[0]?.gas_cost).toBeNull();
    });
  });

  describe('getRolling24hVolume', () => {
    it('should return 0 when there are no trades', () => {
      const volume = getRolling24hVolume(db, 'sui');
      expect(volume).toBe(0);
    });

    it('should sum approved trade volumes', () => {
      logTrade(db, createTradeRecord({ value_usd: 100 }));
      logTrade(db, createTradeRecord({ value_usd: 200 }));

      const volume = getRolling24hVolume(db, 'sui');
      expect(volume).toBe(300);
    });

    it('should not include rejected trades', () => {
      logTrade(db, createTradeRecord({ value_usd: 100 }));
      logTrade(
        db,
        createTradeRecord({
          value_usd: 999,
          policy_decision: 'rejected',
          rejection_reason: 'test',
          rejection_check: 'test',
        }),
      );

      const volume = getRolling24hVolume(db, 'sui');
      expect(volume).toBe(100);
    });

    it('should filter by chain', () => {
      logTrade(db, createTradeRecord({ chain: 'sui', value_usd: 100 }));
      logTrade(db, createTradeRecord({ chain: 'evm', value_usd: 200 }));

      expect(getRolling24hVolume(db, 'sui')).toBe(100);
      expect(getRolling24hVolume(db, 'evm')).toBe(200);
    });

    it('should handle trades with null value_usd', () => {
      logTrade(db, createTradeRecord({ value_usd: 100 }));
      logTrade(db, createTradeRecord({ value_usd: undefined }));

      const volume = getRolling24hVolume(db, 'sui');
      expect(volume).toBe(100);
    });
  });

  describe('getRecentTrades', () => {
    it('should return empty array when no trades exist', () => {
      const trades = getRecentTrades(db, 'sui', 10);
      expect(trades).toHaveLength(0);
    });

    it('should return trades ordered by most recent first', () => {
      logTrade(db, createTradeRecord({ from_token: 'SUI', value_usd: 10 }));
      logTrade(db, createTradeRecord({ from_token: 'USDC', value_usd: 20 }));

      const trades = getRecentTrades(db, 'sui', 10);
      expect(trades).toHaveLength(2);
      // Most recent first (higher ID = later insert)
      expect(trades[0]?.from_token).toBe('USDC');
      expect(trades[1]?.from_token).toBe('SUI');
    });

    it('should respect the limit parameter', () => {
      logTrade(db, createTradeRecord({ value_usd: 10 }));
      logTrade(db, createTradeRecord({ value_usd: 20 }));
      logTrade(db, createTradeRecord({ value_usd: 30 }));

      const trades = getRecentTrades(db, 'sui', 2);
      expect(trades).toHaveLength(2);
    });

    it('should filter by chain', () => {
      logTrade(db, createTradeRecord({ chain: 'sui' }));
      logTrade(db, createTradeRecord({ chain: 'evm' }));

      const suiTrades = getRecentTrades(db, 'sui', 10);
      expect(suiTrades).toHaveLength(1);
      expect(suiTrades[0]?.chain).toBe('sui');
    });
  });
});
