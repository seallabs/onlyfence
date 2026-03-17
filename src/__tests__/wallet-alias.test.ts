import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openMemoryDatabase } from '../db/connection.js';
import {
  generateWallet,
  registerWalletAddress,
  getWalletByAlias,
  switchWallet,
  renameAlias,
  listWallets,
} from '../wallet/manager.js';

describe('wallet alias', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openMemoryDatabase();
  });

  describe('auto-generated alias', () => {
    it('generates alias on generateWallet with pattern sui-1', () => {
      const result = generateWallet(db);
      expect(result.wallets[0]!.alias).toBe('sui-1');
    });

    it('increments alias number for subsequent wallets', () => {
      registerWalletAddress(db, 'sui', '0xaddr1', true, false);
      registerWalletAddress(db, 'sui', '0xaddr2', false, false);
      const wallets = listWallets(db);
      expect(wallets[0]!.alias).toBe('sui-1');
      expect(wallets[1]!.alias).toBe('sui-2');
    });

    it('generates alias on registerWalletAddress', () => {
      const result = registerWalletAddress(db, 'sui', '0xabc', false, false);
      expect(result.wallet.alias).toBe('sui-1');
    });

    it('watch-only gets {chain}-watch-{n} pattern', () => {
      const result = registerWalletAddress(db, 'sui', '0xwatch1', false, true);
      expect(result.wallet.alias).toBe('sui-watch-1');
    });

    it('increments watch-only alias independently', () => {
      registerWalletAddress(db, 'sui', '0xwatch1', false, true);
      const result = registerWalletAddress(db, 'sui', '0xwatch2', false, true);
      expect(result.wallet.alias).toBe('sui-watch-2');
    });
  });

  describe('custom alias', () => {
    it('accepts custom alias on generateWallet', () => {
      const result = generateWallet(db, 'my-wallet');
      expect(result.wallets[0]!.alias).toBe('my-wallet');
    });

    it('accepts custom alias on registerWalletAddress', () => {
      const result = registerWalletAddress(db, 'sui', '0xcustom', false, false, 'custom-name');
      expect(result.wallet.alias).toBe('custom-name');
    });

    it('throws on duplicate alias', () => {
      registerWalletAddress(db, 'sui', '0xfirst', false, false, 'taken');
      expect(() => registerWalletAddress(db, 'sui', '0xsecond', false, false, 'taken')).toThrow(
        'already exists',
      );
    });
  });

  describe('switchWallet', () => {
    it('sets is_primary correctly', () => {
      registerWalletAddress(db, 'sui', '0xwallet1', true, false, 'w1');
      registerWalletAddress(db, 'sui', '0xwallet2', false, false, 'w2');

      switchWallet(db, 'w2');

      const w1 = getWalletByAlias(db, 'w1');
      const w2 = getWalletByAlias(db, 'w2');
      expect(w1!.isPrimary).toBe(false);
      expect(w2!.isPrimary).toBe(true);
    });

    it('throws on unknown alias', () => {
      expect(() => switchWallet(db, 'nonexistent')).toThrow(
        'No wallet found with alias "nonexistent"',
      );
    });

    it('only affects wallets on the same chain', () => {
      registerWalletAddress(db, 'sui', '0xsui1', true, false, 'sui-w');
      registerWalletAddress(db, 'evm', '0xevm1', true, false, 'evm-w');
      registerWalletAddress(db, 'sui', '0xsui2', false, false, 'sui-w2');

      switchWallet(db, 'sui-w2');

      const evmWallet = getWalletByAlias(db, 'evm-w');
      expect(evmWallet!.isPrimary).toBe(true);
    });
  });

  describe('renameAlias', () => {
    it('renames an alias successfully', () => {
      registerWalletAddress(db, 'sui', '0xrename', false, false, 'old-name');
      renameAlias(db, 'old-name', 'new-name');

      expect(getWalletByAlias(db, 'old-name')).toBeNull();
      expect(getWalletByAlias(db, 'new-name')).not.toBeNull();
      expect(getWalletByAlias(db, 'new-name')!.address).toBe('0xrename');
    });

    it('throws on duplicate alias', () => {
      registerWalletAddress(db, 'sui', '0xa', false, false, 'alias-a');
      registerWalletAddress(db, 'sui', '0xb', false, false, 'alias-b');

      expect(() => renameAlias(db, 'alias-a', 'alias-b')).toThrow(
        'Alias "alias-b" is already in use',
      );
    });

    it('throws on unknown alias', () => {
      expect(() => renameAlias(db, 'ghost', 'new')).toThrow('No wallet found with alias "ghost"');
    });

    it('throws on empty new alias', () => {
      registerWalletAddress(db, 'sui', '0xaddr', false, false, 'valid');
      expect(() => renameAlias(db, 'valid', '')).toThrow('Alias must not be empty');
      expect(() => renameAlias(db, 'valid', '   ')).toThrow('Alias must not be empty');
    });
  });

  describe('getWalletByAlias', () => {
    it('returns the correct wallet', () => {
      registerWalletAddress(db, 'sui', '0xlookup', true, false, 'find-me');
      const wallet = getWalletByAlias(db, 'find-me');

      expect(wallet).not.toBeNull();
      expect(wallet!.address).toBe('0xlookup');
      expect(wallet!.chain).toBe('sui');
      expect(wallet!.alias).toBe('find-me');
    });

    it('returns null for unknown alias', () => {
      expect(getWalletByAlias(db, 'does-not-exist')).toBeNull();
    });
  });
});
