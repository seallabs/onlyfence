import type Database from 'better-sqlite3';
import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from 'bip39';
import { deriveSuiKeypair, SUI_DERIVATION_PATH } from './derivation.js';
import type { WalletInfo, WalletRow } from './types.js';

/**
 * Result of generating a new wallet from a BIP-39 mnemonic.
 */
export interface GenerateWalletResult {
  /** The generated BIP-39 mnemonic phrase (must be backed up by the user) */
  readonly mnemonic: string;
  /** Wallet info for each derived chain address */
  readonly wallets: readonly WalletInfo[];
  /** Hex-encoded private key for keystore storage */
  readonly privateKeyHex: string;
}

/**
 * Result of importing a wallet from a mnemonic.
 */
export interface ImportWalletResult {
  /** Wallet info for the imported address */
  readonly wallet: WalletInfo;
  /** Hex-encoded private key for keystore storage */
  readonly privateKeyHex: string;
}

/**
 * Result of registering a wallet address (no private key involved).
 */
export interface RegisterWalletResult {
  /** Wallet info for the registered address */
  readonly wallet: WalletInfo;
}

/**
 * Generate a new BIP-39 mnemonic and derive chain-specific wallets.
 *
 * Currently derives a Sui ed25519 keypair at m/44'/784'/0'/0'/0'.
 * The wallet record is stored in the SQLite wallets table.
 *
 * @param db - SQLite database connection
 * @returns The mnemonic and derived wallet information
 * @throws Error if mnemonic generation or key derivation fails
 */
export function generateWallet(db: Database.Database): GenerateWalletResult {
  const mnemonic = generateMnemonic(256);
  const seed = mnemonicToSeedSync(mnemonic);

  const suiKeypair = deriveSuiKeypair(Buffer.from(seed));
  const suiWallet: WalletInfo = {
    chain: 'sui',
    address: suiKeypair.address,
    derivationPath: SUI_DERIVATION_PATH,
    isPrimary: true,
    isWatchOnly: false,
  };

  insertWallet(db, suiWallet);

  const privateKeyHex = Buffer.from(suiKeypair.secretKey).toString('hex');

  return {
    mnemonic,
    wallets: [suiWallet],
    privateKeyHex,
  };
}

/**
 * Import a wallet from an existing BIP-39 mnemonic.
 *
 * Derives the Sui address using the standard derivation path and stores it in the database.
 *
 * @param db - SQLite database connection
 * @param mnemonic - BIP-39 mnemonic phrase
 * @returns The imported wallet information
 * @throws Error if the mnemonic is invalid or the wallet already exists
 */
export function importFromMnemonic(db: Database.Database, mnemonic: string): ImportWalletResult {
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid BIP-39 mnemonic phrase.');
  }

  const seed = mnemonicToSeedSync(mnemonic);
  const suiKeypair = deriveSuiKeypair(Buffer.from(seed));

  const wallet: WalletInfo = {
    chain: 'sui',
    address: suiKeypair.address,
    derivationPath: SUI_DERIVATION_PATH,
    isPrimary: true,
    isWatchOnly: false,
  };

  insertWallet(db, wallet);

  const privateKeyHex = Buffer.from(suiKeypair.secretKey).toString('hex');

  return { wallet, privateKeyHex };
}

/**
 * Register a wallet address for a specific chain.
 *
 * Unlike `importFromMnemonic`, this function does not take or derive a private key.
 * It simply registers the provided address in the database.
 *
 * @param db - SQLite database connection
 * @param chain - Target chain identifier (e.g., "sui")
 * @param address - The wallet address corresponding to the private key
 * @param isPrimary - Whether this should be set as the primary wallet for the chain
 * @returns The imported wallet information
 * @throws Error if the wallet already exists or parameters are invalid
 */
export function registerWalletAddress(
  db: Database.Database,
  chain: string,
  address: string,
  isPrimary = false,
  isWatchOnly = false,
): RegisterWalletResult {
  if (chain.trim().length === 0) {
    throw new Error('Chain identifier must not be empty.');
  }
  if (address.trim().length === 0) {
    throw new Error('Wallet address must not be empty.');
  }

  const wallet: WalletInfo = {
    chain,
    address,
    derivationPath: null,
    isPrimary,
    isWatchOnly,
  };

  insertWallet(db, wallet);

  return { wallet };
}

/**
 * List all wallets stored in the database.
 *
 * @param db - SQLite database connection
 * @returns Array of wallet information
 */
export function listWallets(db: Database.Database): WalletInfo[] {
  const stmt = db.prepare('SELECT * FROM wallets ORDER BY created_at ASC');
  const rows = stmt.all() as WalletRow[];

  return rows.map(rowToWalletInfo);
}

/**
 * Get the primary wallet for a given chain.
 *
 * @param db - SQLite database connection
 * @param chain - Chain identifier (e.g., "sui")
 * @returns The primary wallet info, or null if none is set
 */
export function getPrimaryWallet(db: Database.Database, chain: string): WalletInfo | null {
  const stmt = db.prepare('SELECT * FROM wallets WHERE is_primary = 1 AND chain = ?');
  const row = stmt.get(chain) as WalletRow | undefined;

  if (row === undefined) {
    return null;
  }

  return rowToWalletInfo(row);
}

/**
 * Insert a wallet record into the wallets table.
 *
 * @param db - SQLite database connection
 * @param wallet - Wallet info to insert
 * @throws Error if a wallet with the same address already exists
 */
function insertWallet(db: Database.Database, wallet: WalletInfo): void {
  const stmt = db.prepare(`
    INSERT INTO wallets (chain, address, derivation_path, is_primary, is_watch_only)
    VALUES (@chain, @address, @derivation_path, @is_primary, @is_watch_only)
  `);

  try {
    stmt.run({
      chain: wallet.chain,
      address: wallet.address,
      derivation_path: wallet.derivationPath,
      is_primary: wallet.isPrimary ? 1 : 0,
      is_watch_only: wallet.isWatchOnly ? 1 : 0,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      throw new Error(`Wallet with address "${wallet.address}" already exists.`);
    }
    throw err;
  }
}

/**
 * Convert a database wallet row to a WalletInfo object.
 */
function rowToWalletInfo(row: WalletRow): WalletInfo {
  return {
    chain: row.chain,
    address: row.address,
    derivationPath: row.derivation_path,
    isPrimary: row.is_primary === 1,
    isWatchOnly: row.is_watch_only === 1,
  };
}
