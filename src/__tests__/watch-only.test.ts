import { describe, it, expect } from 'vitest';
import { openMemoryDatabase } from '../db/connection.js';
import { registerWalletAddress, getPrimaryWallet, listWallets } from '../wallet/manager.js';

describe('watch-only wallet', () => {
  it('registers a watch-only wallet with isWatchOnly=true', () => {
    const db = openMemoryDatabase();
    registerWalletAddress(db, 'sui', '0x' + 'a'.repeat(64), false, true);
    const wallets = listWallets(db);
    expect(wallets).toHaveLength(1);
    expect(wallets[0]!.isWatchOnly).toBe(true);
    expect(wallets[0]!.derivationPath).toBeNull();
  });

  it('regular wallet has isWatchOnly=false', () => {
    const db = openMemoryDatabase();
    registerWalletAddress(db, 'sui', '0x' + 'b'.repeat(64), true, false);
    const wallet = getPrimaryWallet(db, 'sui');
    expect(wallet).not.toBeNull();
    expect(wallet!.isWatchOnly).toBe(false);
  });

  it('isWatchOnly defaults to false when not provided', () => {
    const db = openMemoryDatabase();
    registerWalletAddress(db, 'sui', '0x' + 'c'.repeat(64), true);
    const wallet = getPrimaryWallet(db, 'sui');
    expect(wallet!.isWatchOnly).toBe(false);
  });
});
