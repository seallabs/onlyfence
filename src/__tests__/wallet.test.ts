import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateMnemonic, mnemonicToSeedSync } from 'bip39';
import type Database from 'better-sqlite3';
import { openMemoryDatabase } from '../db/connection.js';
import {
  generateWallet,
  importFromMnemonic,
  registerWalletAddress,
  listWallets,
  getPrimaryWallet,
} from '../wallet/manager.js';
import {
  saveKeystore,
  loadKeystore,
  encryptKeystoreData,
  decryptKeystoreData,
} from '../wallet/keystore.js';
import {
  deriveSuiKeypair,
  publicKeyToSuiAddress,
  SUI_DERIVATION_PATH,
} from '../wallet/derivation.js';
import type { KeystoreData } from '../wallet/types.js';

describe('Wallet Derivation', () => {
  // Known test mnemonic for deterministic testing
  const TEST_MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  it('should derive a consistent Sui address from the same seed', () => {
    const seed = mnemonicToSeedSync(TEST_MNEMONIC);
    const keypair1 = deriveSuiKeypair(Buffer.from(seed));
    const keypair2 = deriveSuiKeypair(Buffer.from(seed));

    expect(keypair1.address).toBe(keypair2.address);
    expect(Buffer.from(keypair1.publicKey).toString('hex')).toBe(
      Buffer.from(keypair2.publicKey).toString('hex'),
    );
  });

  it('should produce a valid Sui address format (0x prefix + 64 hex chars)', () => {
    const seed = mnemonicToSeedSync(TEST_MNEMONIC);
    const keypair = deriveSuiKeypair(Buffer.from(seed));

    expect(keypair.address).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('should produce a 32-byte public key', () => {
    const seed = mnemonicToSeedSync(TEST_MNEMONIC);
    const keypair = deriveSuiKeypair(Buffer.from(seed));

    expect(keypair.publicKey.length).toBe(32);
  });

  it('should produce a 64-byte secret key (tweetnacl format)', () => {
    const seed = mnemonicToSeedSync(TEST_MNEMONIC);
    const keypair = deriveSuiKeypair(Buffer.from(seed));

    expect(keypair.secretKey.length).toBe(64);
  });

  it('should derive different addresses from different mnemonics', () => {
    const seed1 = mnemonicToSeedSync(TEST_MNEMONIC);
    const seed2 = mnemonicToSeedSync('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong');

    const keypair1 = deriveSuiKeypair(Buffer.from(seed1));
    const keypair2 = deriveSuiKeypair(Buffer.from(seed2));

    expect(keypair1.address).not.toBe(keypair2.address);
  });

  it('should use the default Sui derivation path', () => {
    expect(SUI_DERIVATION_PATH).toBe("m/44'/784'/0'/0'/0'");
  });

  it('publicKeyToSuiAddress should produce consistent output', () => {
    const seed = mnemonicToSeedSync(TEST_MNEMONIC);
    const keypair = deriveSuiKeypair(Buffer.from(seed));

    const addr1 = publicKeyToSuiAddress(keypair.publicKey);
    const addr2 = publicKeyToSuiAddress(keypair.publicKey);
    expect(addr1).toBe(addr2);
    expect(addr1).toBe(keypair.address);
  });
});

describe('Wallet Manager', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openMemoryDatabase();
  });

  describe('generateWallet', () => {
    it('should generate a valid BIP-39 mnemonic', () => {
      const result = generateWallet(db);
      expect(validateMnemonic(result.mnemonic)).toBe(true);
    });

    it('should generate a 24-word mnemonic', () => {
      const result = generateWallet(db);
      const words = result.mnemonic.split(' ');
      expect(words.length).toBe(24);
    });

    it('should derive at least one wallet', () => {
      const result = generateWallet(db);
      expect(result.wallets.length).toBeGreaterThanOrEqual(1);
    });

    it('should create a Sui wallet with the correct derivation path', () => {
      const result = generateWallet(db);
      const suiWallet = result.wallets.find((w) => w.chainId === 'sui:mainnet');
      expect(suiWallet).toBeDefined();
      expect(suiWallet?.derivationPath).toBe(SUI_DERIVATION_PATH);
      expect(suiWallet?.isPrimary).toBe(true);
    });

    it('should store the wallet in the database', () => {
      const result = generateWallet(db);
      const wallets = listWallets(db);
      expect(wallets.length).toBe(1);
      expect(wallets[0]?.address).toBe(result.wallets[0]?.address);
    });
  });

  describe('importFromMnemonic', () => {
    const TEST_MNEMONIC =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    it('should import a valid mnemonic and derive the Sui address', () => {
      const result = importFromMnemonic(db, TEST_MNEMONIC);
      expect(result.wallet.chainId).toBe('sui:mainnet');
      expect(result.wallet.address).toMatch(/^0x[0-9a-f]{64}$/);
      expect(result.wallet.derivationPath).toBe(SUI_DERIVATION_PATH);
    });

    it('should produce the same address as generateWallet for the same mnemonic', () => {
      // Derive manually to compare
      const seed = mnemonicToSeedSync(TEST_MNEMONIC);
      const keypair = deriveSuiKeypair(Buffer.from(seed));

      const result = importFromMnemonic(db, TEST_MNEMONIC);
      expect(result.wallet.address).toBe(keypair.address);
    });

    it('should throw on an invalid mnemonic', () => {
      expect(() => importFromMnemonic(db, 'not a valid mnemonic phrase')).toThrow(
        'Invalid BIP-39 mnemonic',
      );
    });

    it('should throw on duplicate import', () => {
      importFromMnemonic(db, TEST_MNEMONIC);
      expect(() => importFromMnemonic(db, TEST_MNEMONIC)).toThrow('already exists');
    });
  });

  describe('registerWalletAddress', () => {
    it('should import a wallet with a raw key', () => {
      const result = registerWalletAddress(db, 'sui', '0xabc123', true);
      expect(result.wallet.chainId).toBe('sui');
      expect(result.wallet.address).toBe('0xabc123');
      expect(result.wallet.derivationPath).toBeNull();
      expect(result.wallet.isPrimary).toBe(true);
    });

    it('should throw on empty chain', () => {
      expect(() => registerWalletAddress(db, '', '0xabc')).toThrow(
        'Chain identifier must not be empty',
      );
    });

    it('should throw on empty address', () => {
      expect(() => registerWalletAddress(db, 'sui', '')).toThrow(
        'Wallet address must not be empty',
      );
    });
  });

  describe('listWallets', () => {
    it('should return empty array when no wallets exist', () => {
      expect(listWallets(db)).toEqual([]);
    });

    it('should return all inserted wallets', () => {
      registerWalletAddress(db, 'sui', '0xaddr1', true);
      registerWalletAddress(db, 'evm', '0xaddr2', false);

      const wallets = listWallets(db);
      expect(wallets.length).toBe(2);
    });
  });

  describe('getPrimaryWallet', () => {
    it('should return null when no wallets exist', () => {
      expect(getPrimaryWallet(db, 'sui')).toBeNull();
    });

    it('should return the primary wallet for a chain', () => {
      registerWalletAddress(db, 'sui', '0xprimary', true);
      registerWalletAddress(db, 'sui', '0xsecondary', false);

      const primary = getPrimaryWallet(db, 'sui');
      expect(primary).not.toBeNull();
      expect(primary?.address).toBe('0xprimary');
      expect(primary?.isPrimary).toBe(true);
    });

    it('should return null for a chain with no primary wallet', () => {
      registerWalletAddress(db, 'sui', '0xaddr', false);
      expect(getPrimaryWallet(db, 'sui')).toBeNull();
    });

    it('should filter by chain', () => {
      registerWalletAddress(db, 'sui', '0xsui_primary', true);
      registerWalletAddress(db, 'evm', '0xevm_primary', true);

      const suiPrimary = getPrimaryWallet(db, 'sui');
      expect(suiPrimary?.address).toBe('0xsui_primary');

      const evmPrimary = getPrimaryWallet(db, 'evm');
      expect(evmPrimary?.address).toBe('0xevm_primary');
    });
  });
});

describe('Keystore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'onlyfence-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const TEST_DATA: KeystoreData = {
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    keys: {
      sui: 'deadbeef01234567890abcdef01234567890abcdef01234567890abcdef0123',
    },
  };

  describe('encrypt/decrypt round-trip', () => {
    it('should round-trip keystore data through encrypt and decrypt', () => {
      const password = 'test-password-123';
      const encrypted = encryptKeystoreData(TEST_DATA, password);

      expect(encrypted.version).toBe(1);
      expect(encrypted.salt).toMatch(/^[0-9a-f]+$/);
      expect(encrypted.iv).toMatch(/^[0-9a-f]+$/);
      expect(encrypted.ciphertext).toMatch(/^[0-9a-f]+$/);
      expect(encrypted.tag).toMatch(/^[0-9a-f]+$/);

      const decrypted = decryptKeystoreData(encrypted, password);
      expect(decrypted.mnemonic).toBe(TEST_DATA.mnemonic);
      expect(decrypted.keys).toEqual(TEST_DATA.keys);
    });

    it('should produce different ciphertexts for the same data (random salt/iv)', () => {
      const password = 'test-password';
      const enc1 = encryptKeystoreData(TEST_DATA, password);
      const enc2 = encryptKeystoreData(TEST_DATA, password);

      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
      expect(enc1.salt).not.toBe(enc2.salt);
      expect(enc1.iv).not.toBe(enc2.iv);
    });
  });

  describe('wrong password', () => {
    it('should throw on wrong password', () => {
      const encrypted = encryptKeystoreData(TEST_DATA, 'correct-password');

      expect(() => decryptKeystoreData(encrypted, 'wrong-password')).toThrow(
        'wrong password or corrupted data',
      );
    });
  });

  describe('file-based save/load', () => {
    it('should save and load keystore from disk', () => {
      const path = join(tmpDir, 'keystore');
      const password = 'file-password';

      saveKeystore(TEST_DATA, password, path);
      expect(existsSync(path)).toBe(true);

      // Verify it's valid JSON on disk
      const content = JSON.parse(readFileSync(path, 'utf-8'));
      expect(content.version).toBe(1);

      const loaded = loadKeystore(password, path);
      expect(loaded.mnemonic).toBe(TEST_DATA.mnemonic);
      expect(loaded.keys).toEqual(TEST_DATA.keys);
    });

    it('should throw descriptive error for missing keystore file', () => {
      expect(() => loadKeystore('password', join(tmpDir, 'nonexistent'))).toThrow(
        'Keystore file not found',
      );
    });

    it('should throw on corrupted keystore file', () => {
      const path = join(tmpDir, 'corrupted');
      writeFileSync(path, 'not-json-at-all', 'utf-8');

      expect(() => loadKeystore('password', path)).toThrow('corrupted');
    });

    it('should create nested directories when saving', () => {
      const nestedPath = join(tmpDir, 'a', 'b', 'c', 'keystore');
      saveKeystore(TEST_DATA, 'pw', nestedPath);
      expect(existsSync(nestedPath)).toBe(true);
    });
  });

  describe('keystore data without mnemonic', () => {
    it('should handle keystore data with only keys (no mnemonic)', () => {
      const dataNoMnemonic: KeystoreData = {
        keys: { sui: 'abcdef1234' },
      };

      const encrypted = encryptKeystoreData(dataNoMnemonic, 'pw');
      const decrypted = decryptKeystoreData(encrypted, 'pw');

      expect(decrypted.mnemonic).toBeUndefined();
      expect(decrypted.keys).toEqual(dataNoMnemonic.keys);
    });
  });
});
