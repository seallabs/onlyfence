import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CoinMetadataRow } from '../db/coin-metadata-repo.js';
import { CoinMetadataRepository } from '../db/coin-metadata-repo.js';
import { openMemoryDatabase } from '../db/connection.js';

describe('CoinMetadataRepository', () => {
  let db: Database.Database;
  let repo: CoinMetadataRepository;

  beforeEach(() => {
    db = openMemoryDatabase();
    repo = new CoinMetadataRepository(db);
  });

  const suiRow: CoinMetadataRow = {
    coin_type: '0x2::sui::SUI',
    chain_id: 'sui',
    symbol: 'SUI',
    name: 'Sui',
    decimals: 9,
  };

  const usdcRow: CoinMetadataRow = {
    coin_type: '0xdba3::usdc::USDC',
    chain_id: 'sui',
    symbol: 'USDC',
    name: null,
    decimals: 6,
  };

  describe('get', () => {
    it('returns null when no entry exists', () => {
      expect(repo.get('0x2::sui::SUI', 'sui')).toBeNull();
    });

    it('returns the row after upsert', () => {
      repo.upsert(suiRow);
      const result = repo.get('0x2::sui::SUI', 'sui');
      expect(result).toEqual(suiRow);
    });

    it('distinguishes by chain', () => {
      repo.upsert(suiRow);
      expect(repo.get('0x2::sui::SUI', 'evm')).toBeNull();
    });
  });

  describe('upsert', () => {
    it('inserts a new row', () => {
      repo.upsert(suiRow);
      expect(repo.get('0x2::sui::SUI', 'sui')).toEqual(suiRow);
    });

    it('replaces an existing row on conflict', () => {
      repo.upsert(suiRow);
      const updated = { ...suiRow, symbol: 'SUI2', decimals: 18 };
      repo.upsert(updated);
      expect(repo.get('0x2::sui::SUI', 'sui')).toEqual(updated);
    });
  });

  describe('getBulk', () => {
    it('returns empty array when no entries match', () => {
      expect(repo.getBulk(['0x2::sui::SUI'], 'sui')).toEqual([]);
    });

    it('returns matching rows', () => {
      repo.upsert(suiRow);
      repo.upsert(usdcRow);
      const results = repo.getBulk(['0x2::sui::SUI', '0xdba3::usdc::USDC'], 'sui');
      expect(results).toHaveLength(2);
      expect(results).toContainEqual(suiRow);
      expect(results).toContainEqual(usdcRow);
    });

    it('returns only rows matching the chain', () => {
      repo.upsert(suiRow);
      expect(repo.getBulk(['0x2::sui::SUI'], 'evm')).toEqual([]);
    });

    it('handles empty coinTypes array', () => {
      expect(repo.getBulk([], 'sui')).toEqual([]);
    });
  });

  describe('upsertBulk', () => {
    it('inserts multiple rows in a transaction', () => {
      repo.upsertBulk([suiRow, usdcRow]);
      expect(repo.get('0x2::sui::SUI', 'sui')).toEqual(suiRow);
      expect(repo.get('0xdba3::usdc::USDC', 'sui')).toEqual(usdcRow);
    });

    it('handles empty array without error', () => {
      repo.upsertBulk([]);
      expect(repo.getBulk([], 'sui')).toEqual([]);
    });
  });
});
