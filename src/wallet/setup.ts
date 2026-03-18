import type Database from 'better-sqlite3';
import { openDatabase, DB_PATH } from '../db/connection.js';
import { initConfig, CONFIG_PATH } from '../config/loader.js';
import { ConfigAlreadyExistsError } from '../config/schema.js';
import { generateWallet, importFromMnemonic } from './manager.js';
import { saveKeystore } from './keystore.js';
import { SUI_CHAIN_ID } from '../chain/sui/adapter.js';
import type { KeystoreData } from './types.js';

/**
 * Result of wallet setup (generate or import).
 * Shared between CLI and TUI setup flows.
 */
export interface SetupResult {
  readonly mnemonic: string;
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
 * Encrypt and save the keystore for a setup result.
 *
 * @param result - Setup result containing private key material
 * @param password - Password to encrypt the keystore with
 */
export function saveSetupKeystore(result: SetupResult, password: string): void {
  const keystoreData: KeystoreData = {
    mnemonic: result.mnemonic,
    keys: { [result.chainId]: result.privateKeyHex },
  };
  saveKeystore(keystoreData, password);
}
