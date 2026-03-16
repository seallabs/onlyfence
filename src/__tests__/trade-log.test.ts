import { describe, it, expect, beforeEach } from 'vitest';
import { openMemoryDatabase } from '../db/connection.js';
import { TradeLog } from '../db/trade-log.js';
import { createTradeRecord, insertTestWallet } from './helpers.js';
import type Database from 'better-sqlite3';

describe('TradeLog', () => {
  let db: Database.Database;
  let tradeLog: TradeLog;

  beforeEach(() => {
    db = openMemoryDatabase();
    tradeLog = new TradeLog(db);
    insertTestWallet(db, '0xabc');
  });

  describe('logTrade', () => {
    it('should insert a trade and return the row ID', () => {
      const id = tradeLog.logTrade(createTradeRecord());
      expect(id).toBe(1);

      const id2 = tradeLog.logTrade(createTradeRecord({ tx_digest: '0xdigest456' }));
      expect(id2).toBe(2);
    });

    it('should handle null value_usd correctly', () => {
      const id = tradeLog.logTrade(createTradeRecord({ value_usd: undefined }));
      expect(id).toBe(1);

      const rows = tradeLog.getRecentTrades('sui', 10);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.value_usd).toBeNull();
    });

    it('should handle optional fields as null', () => {
      const id = tradeLog.logTrade({
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

      const rows = tradeLog.getRecentTrades('sui', 10);
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
      const volume = tradeLog.getRolling24hVolume('sui');
      expect(volume).toBe(0);
    });

    it('should sum approved trade volumes', () => {
      tradeLog.logTrade(createTradeRecord({ value_usd: 100 }));
      tradeLog.logTrade(createTradeRecord({ value_usd: 200 }));

      const volume = tradeLog.getRolling24hVolume('sui');
      expect(volume).toBe(300);
    });

    it('should not include rejected trades', () => {
      tradeLog.logTrade(createTradeRecord({ value_usd: 100 }));
      tradeLog.logTrade(
        createTradeRecord({
          value_usd: 999,
          policy_decision: 'rejected',
          rejection_reason: 'test',
          rejection_check: 'test',
        }),
      );

      const volume = tradeLog.getRolling24hVolume('sui');
      expect(volume).toBe(100);
    });

    it('should filter by chain', () => {
      tradeLog.logTrade(createTradeRecord({ chain: 'sui', value_usd: 100 }));
      tradeLog.logTrade(createTradeRecord({ chain: 'evm', value_usd: 200 }));

      expect(tradeLog.getRolling24hVolume('sui')).toBe(100);
      expect(tradeLog.getRolling24hVolume('evm')).toBe(200);
    });

    it('should handle trades with null value_usd', () => {
      tradeLog.logTrade(createTradeRecord({ value_usd: 100 }));
      tradeLog.logTrade(createTradeRecord({ value_usd: undefined }));

      const volume = tradeLog.getRolling24hVolume('sui');
      expect(volume).toBe(100);
    });
  });

  describe('getRecentTrades', () => {
    it('should return empty array when no trades exist', () => {
      const trades = tradeLog.getRecentTrades('sui', 10);
      expect(trades).toHaveLength(0);
    });

    it('should return trades ordered by most recent first', () => {
      tradeLog.logTrade(createTradeRecord({ from_token: 'SUI', value_usd: 10 }));
      tradeLog.logTrade(createTradeRecord({ from_token: 'USDC', value_usd: 20 }));

      const trades = tradeLog.getRecentTrades('sui', 10);
      expect(trades).toHaveLength(2);
      // Most recent first (higher ID = later insert)
      expect(trades[0]?.from_token).toBe('USDC');
      expect(trades[1]?.from_token).toBe('SUI');
    });

    it('should respect the limit parameter', () => {
      tradeLog.logTrade(createTradeRecord({ value_usd: 10 }));
      tradeLog.logTrade(createTradeRecord({ value_usd: 20 }));
      tradeLog.logTrade(createTradeRecord({ value_usd: 30 }));

      const trades = tradeLog.getRecentTrades('sui', 2);
      expect(trades).toHaveLength(2);
    });

    it('should support offset for pagination', () => {
      tradeLog.logTrade(createTradeRecord({ from_token: 'SUI', value_usd: 10 }));
      tradeLog.logTrade(createTradeRecord({ from_token: 'USDC', value_usd: 20 }));
      tradeLog.logTrade(createTradeRecord({ from_token: 'DEEP', value_usd: 30 }));

      // Most recent first: DEEP, USDC, SUI — skip first, get next 2
      const trades = tradeLog.getRecentTrades('sui', 2, 1);
      expect(trades).toHaveLength(2);
      expect(trades[0]?.from_token).toBe('USDC');
      expect(trades[1]?.from_token).toBe('SUI');
    });

    it('should filter by chain', () => {
      tradeLog.logTrade(createTradeRecord({ chain: 'sui' }));
      tradeLog.logTrade(createTradeRecord({ chain: 'evm' }));

      const suiTrades = tradeLog.getRecentTrades('sui', 10);
      expect(suiTrades).toHaveLength(1);
      expect(suiTrades[0]?.chain).toBe('sui');
    });
  });

  describe('getTradeCount', () => {
    it('should return 0 when no trades exist', () => {
      expect(tradeLog.getTradeCount('sui')).toBe(0);
    });

    it('should count all trades for a chain', () => {
      tradeLog.logTrade(createTradeRecord());
      tradeLog.logTrade(createTradeRecord({ tx_digest: '0x2' }));
      tradeLog.logTrade(createTradeRecord({ chain: 'evm', tx_digest: '0x3' }));

      expect(tradeLog.getTradeCount('sui')).toBe(2);
      expect(tradeLog.getTradeCount('evm')).toBe(1);
    });
  });
});
