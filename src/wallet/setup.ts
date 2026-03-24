import { existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { openDatabase, DB_PATH } from '../db/connection.js';
import { initConfig, CONFIG_PATH } from '../config/loader.js';
import { ConfigAlreadyExistsError } from '../config/schema.js';
import { generateWallet, importFromMnemonic, importFromPrivateKey } from './manager.js';
import { saveKeystore, loadKeystore, DEFAULT_KEYSTORE_PATH } from './keystore.js';
import { SUI_CHAIN_ID } from '../chain/sui/adapter.js';
import type { KeystoreData } from './types.js';

/**
 * Result of wallet setup (generate or import).
 * Shared between CLI and TUI setup flows.
 */
export interface SetupResult {
  readonly mnemonic?: string;
  readonly address: string;
  readonly chainId: string;
  readonly derivationPath: string | null;
  readonly privateKeyHex: string;
}

/**
 * Open the database and create default config if it doesn't exist.
 * Convenience for the common first-run init pattern.
 *
 * @returns Open database connection (caller must close when done)
 */
export function ensureSetupEnvironment(): Database.Database {
  const db = openDatabase(DB_PATH);
  try {
    initConfig(CONFIG_PATH, false);
  } catch (err: unknown) {
    if (!(err instanceof ConfigAlreadyExistsError)) throw err;
  }
  return db;
}

/**
 * Generate a new wallet and return the setup result.
 *
 * @param db - Open database connection
 * @returns Setup result with mnemonic, address, and private key
 */
export function generateSetupWallet(db: Database.Database, alias?: string): SetupResult {
  const result = generateWallet(db, alias);
  const wallet = result.wallets[0];
  return {
    mnemonic: result.mnemonic,
    address: wallet?.address ?? '',
    chainId: wallet?.chainId ?? SUI_CHAIN_ID,
    derivationPath: wallet?.derivationPath ?? null,
    privateKeyHex: result.privateKeyHex,
  };
}

/**
 * Import a wallet from a mnemonic and return the setup result.
 *
 * @param db - Open database connection
 * @param mnemonic - BIP-39 mnemonic phrase
 * @returns Setup result with mnemonic, address, and private key
 */
export function importSetupWallet(
  db: Database.Database,
  mnemonic: string,
  alias?: string,
): SetupResult {
  const trimmed = mnemonic.trim();
  const result = importFromMnemonic(db, trimmed, alias);
  return {
    mnemonic: trimmed,
    address: result.wallet.address,
    chainId: result.wallet.chainId,
    derivationPath: result.wallet.derivationPath,
    privateKeyHex: result.privateKeyHex,
  };
}

/**
 * Import a wallet from a raw private key and return the setup result.
 *
 * @param db - Open database connection
 * @param privateKeyInput - Private key in hex or suiprivkey bech32 format
 * @param alias - Optional custom alias for the wallet
 * @returns Setup result with address and private key (no mnemonic)
 */
export function importSetupWalletFromKey(
  db: Database.Database,
  privateKeyInput: string,
  alias?: string,
): SetupResult {
  const result = importFromPrivateKey(db, privateKeyInput, alias);
  return {
    address: result.wallet.address,
    chainId: result.wallet.chainId,
    derivationPath: null,
    privateKeyHex: result.privateKeyHex,
  };
}

/**
 * Encrypt and save the keystore for a setup result.
 *
 * @param result - Setup result containing private key material
 * @param password - Password to encrypt the keystore with
 */
export function saveSetupKeystore(result: SetupResult, password: string): void {
  const keystoreData: KeystoreData = {
    ...(result.mnemonic !== undefined ? { mnemonic: result.mnemonic } : {}),
    keys: { [result.chainId]: result.privateKeyHex },
  };
  saveKeystore(keystoreData, password);
}

/**
 * Merge a new private key into the encrypted keystore file.
 *
 * If the keystore file exists, it is decrypted, the new key is added (or
 * replaces an existing key for the same chain), and re-encrypted.
 * If no keystore exists, a new one is created with just this key.
 *
 * @param chainId - Chain identifier (e.g., "sui:mainnet")
 * @param privateKeyHex - Hex-encoded private key to store
 * @param password - Keystore encryption password
 * @param path - Keystore file path (defaults to ~/.onlyfence/keystore)
 */
export function mergeKeyIntoKeystore(
  chainId: string,
  privateKeyHex: string,
  password: string,
  path?: string,
): void {
  let existing: KeystoreData;

  const resolvedPath = path ?? DEFAULT_KEYSTORE_PATH;

  if (existsSync(resolvedPath)) {
    existing = loadKeystore(password, resolvedPath);
  } else {
    existing = { keys: {} };
  }

  const merged: KeystoreData = {
    ...existing,
    keys: { ...existing.keys, [chainId]: privateKeyHex },
  };

  saveKeystore(merged, password, resolvedPath);
}
