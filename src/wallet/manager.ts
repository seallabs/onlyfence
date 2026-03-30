import type Database from 'better-sqlite3';
import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from 'bip39';
import type { ChainDefinition } from '../chain/registry.js';
import type { WalletInfo, WalletRow } from './types.js';

/**
 * Result of generating a new wallet from a BIP-39 mnemonic.
 */
export interface GenerateWalletResult {
  /** The generated BIP-39 mnemonic phrase (must be backed up by the user) */
  readonly mnemonic: string;
  /** Wallet info for each derived chain address */
  readonly wallets: readonly WalletInfo[];
  /** Per-chain hex-encoded private keys (chainId -> hex) */
  readonly keys: Record<string, string>;
}

/**
 * Result of importing wallets from a mnemonic.
 */
export interface ImportWalletResult {
  /** Wallet info for each imported chain address */
  readonly wallets: readonly WalletInfo[];
  /** Per-chain hex-encoded private keys (chainId -> hex) */
  readonly keys: Record<string, string>;
}

/**
 * Result of registering a wallet address (no private key involved).
 */
export interface RegisterWalletResult {
  /** Wallet info for the registered address */
  readonly wallet: WalletInfo;
}

/**
 * Result of importing a wallet from a raw private key.
 */
export interface ImportFromKeyResult {
  /** Wallet info for the imported address */
  readonly wallet: WalletInfo;
  /** Hex-encoded 32-byte private key seed for keystore storage */
  readonly privateKeyHex: string;
}

/**
 * Generate the next available alias for a wallet.
 *
 * Format: `{chain}-{n}` for regular wallets, `{chain}-watch-{n}` for watch-only.
 *
 * @param db - SQLite database connection
 * @param chain - Chain identifier (e.g., "sui")
 * @param isWatchOnly - Whether this is a watch-only wallet
 * @returns The generated alias string
 */
function generateAlias(db: Database.Database, chain: string, isWatchOnly: boolean): string {
  const prefix = isWatchOnly ? `${chain}-watch` : chain;
  const pattern = `${prefix}-%`;
  const existing = db.prepare('SELECT alias FROM wallets WHERE alias LIKE ?').all(pattern) as {
    alias: string;
  }[];

  // Find the max number
  let max = 0;
  for (const row of existing) {
    const suffix = row.alias.slice(prefix.length + 1);
    const num = parseInt(suffix, 10);
    if (!isNaN(num) && num > max) max = num;
  }
  return `${prefix}-${max + 1}`;
}

/**
 * Generate a new BIP-39 mnemonic and derive wallets for the given chains.
 *
 * For each chain, derives a keypair using the chain's BIP-44 derivation path
 * and stores the wallet record in the SQLite wallets table.
 *
 * @param db - SQLite database connection
 * @param chains - Chain definitions to derive wallets for
 * @param alias - Optional custom alias prefix for wallets
 * @returns The mnemonic, derived wallet information, and per-chain keys
 * @throws Error if mnemonic generation or key derivation fails
 */
export function generateWallet(
  db: Database.Database,
  chains: readonly ChainDefinition[],
  alias?: string,
): GenerateWalletResult {
  if (chains.length === 0) {
    throw new Error('At least one chain must be specified for wallet generation.');
  }

  const mnemonic = generateMnemonic(256);
  const seed = mnemonicToSeedSync(mnemonic);
  const { wallets, keys } = deriveAndStoreWallets(db, seed, chains, alias);

  return { mnemonic, wallets, keys };
}

/**
 * Import wallets from an existing BIP-39 mnemonic for the given chains.
 *
 * Derives chain-specific addresses using each chain's standard derivation path.
 *
 * @param db - SQLite database connection
 * @param mnemonic - BIP-39 mnemonic phrase
 * @param chains - Chain definitions to derive wallets for
 * @param alias - Optional custom alias prefix for wallets
 * @returns The imported wallet information and per-chain keys
 * @throws Error if the mnemonic is invalid or a wallet already exists
 */
export function importFromMnemonic(
  db: Database.Database,
  mnemonic: string,
  chains: readonly ChainDefinition[],
  alias?: string,
): ImportWalletResult {
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid BIP-39 mnemonic phrase.');
  }
  if (chains.length === 0) {
    throw new Error('At least one chain must be specified for wallet import.');
  }

  const seed = mnemonicToSeedSync(mnemonic);
  return deriveAndStoreWallets(db, seed, chains, alias);
}

/**
 * Derive wallets from a BIP-39 seed for each chain and store in the database.
 */
function deriveAndStoreWallets(
  db: Database.Database,
  seed: Uint8Array,
  chains: readonly ChainDefinition[],
  alias?: string,
): { wallets: WalletInfo[]; keys: Record<string, string> } {
  const seedBuf = Buffer.from(seed);
  const wallets: WalletInfo[] = [];
  const keys: Record<string, string> = {};

  for (const chain of chains) {
    const derived = chain.walletDerivation.deriveFromSeed(seedBuf);
    const walletAlias = alias ?? generateAlias(db, chain.name, false);

    const wallet: WalletInfo = {
      chainId: chain.defaultChainId,
      address: derived.address,
      derivationPath: chain.walletDerivation.derivationPath,
      isPrimary: true,
      isWatchOnly: false,
      alias: walletAlias,
    };

    insertWallet(db, wallet);
    wallets.push(wallet);
    keys[chain.defaultChainId] = Buffer.from(derived.secretKey).toString('hex');
  }

  return { wallets, keys };
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
 * @param isWatchOnly - Whether this is a watch-only wallet
 * @param alias - Optional custom alias for the wallet
 * @returns The imported wallet information
 * @throws Error if the wallet already exists or parameters are invalid
 */
export function registerWalletAddress(
  db: Database.Database,
  chain: string,
  address: string,
  isPrimary = false,
  isWatchOnly = false,
  alias?: string,
): RegisterWalletResult {
  if (chain.trim().length === 0) {
    throw new Error('Chain identifier must not be empty.');
  }
  if (address.trim().length === 0) {
    throw new Error('Wallet address must not be empty.');
  }

  const resolvedAlias = alias ?? generateAlias(db, chain, isWatchOnly);

  const wallet: WalletInfo = {
    chainId: chain,
    address,
    derivationPath: null,
    isPrimary,
    isWatchOnly,
    alias: resolvedAlias,
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
 * @param chain - Chain identifier (e.g., "sui:mainnet")
 * @returns The primary wallet info, or null if none is set
 */
export function getPrimaryWallet(db: Database.Database, chain: string): WalletInfo | null {
  const stmt = db.prepare('SELECT * FROM wallets WHERE is_primary = 1 AND chain_id = ?');
  const row = stmt.get(chain) as WalletRow | undefined;

  if (row === undefined) {
    return null;
  }

  return rowToWalletInfo(row);
}

/**
 * Look up a wallet by its alias.
 *
 * @param db - SQLite database connection
 * @param alias - The alias to search for
 * @returns The wallet info, or null if not found
 */
export function getWalletByAlias(db: Database.Database, alias: string): WalletInfo | null {
  const row = db.prepare('SELECT * FROM wallets WHERE alias = ?').get(alias) as
    | WalletRow
    | undefined;
  return row === undefined ? null : rowToWalletInfo(row);
}

/**
 * Set a wallet as the primary wallet for its chain.
 *
 * Unsets all other wallets on the same chain, then sets the target wallet as primary.
 *
 * @param db - SQLite database connection
 * @param alias - The alias of the wallet to switch to
 * @throws Error if no wallet is found with the given alias
 */
export function switchWallet(db: Database.Database, alias: string): void {
  const wallet = getWalletByAlias(db, alias);
  if (wallet === null) {
    throw new Error(`No wallet found with alias "${alias}"`);
  }
  // Unset all primaries for this chain
  db.prepare('UPDATE wallets SET is_primary = 0 WHERE chain_id = ?').run(wallet.chainId);
  // Set this wallet as primary
  db.prepare('UPDATE wallets SET is_primary = 1 WHERE alias = ?').run(alias);
}

/**
 * Rename a wallet alias.
 *
 * @param db - SQLite database connection
 * @param oldAlias - The current alias
 * @param newAlias - The desired new alias
 * @throws Error if the old alias is not found, the new alias is empty, or the new alias is already taken
 */
export function renameAlias(db: Database.Database, oldAlias: string, newAlias: string): void {
  if (newAlias.trim().length === 0) {
    throw new Error('Alias must not be empty');
  }
  const wallet = getWalletByAlias(db, oldAlias);
  if (wallet === null) {
    throw new Error(`No wallet found with alias "${oldAlias}"`);
  }
  try {
    db.prepare('UPDATE wallets SET alias = ? WHERE alias = ?').run(newAlias, oldAlias);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      throw new Error(`Alias "${newAlias}" is already in use`);
    }
    throw err;
  }
}

/**
 * Parse a private key string into a 32-byte ed25519 seed.
 *
 * Tries chain-specific parsing first (e.g., `suiprivkey1…` bech32 for Sui),
 * then falls back to 64-character hex string.
 *
 * @param input - Private key in hex or chain-specific format
 * @param chain - Chain definition for chain-specific key parsing
 * @returns 32-byte Uint8Array seed
 * @throws Error if the input format is invalid
 */
function parsePrivateKeyInput(input: string, chain: ChainDefinition): Uint8Array {
  const trimmed = input.trim();

  // Try chain-specific parsing first. If the chain parser recognizes the
  // format but finds it invalid (bad checksum, wrong scheme), let that
  // error propagate — don't mask it with a generic hex-format message.
  let chainParseError: Error | undefined;
  if (chain.walletDerivation.parsePrivateKey !== undefined) {
    try {
      return chain.walletDerivation.parsePrivateKey(trimmed);
    } catch (err: unknown) {
      chainParseError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // Hex format: must be exactly 64 hex chars (32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return new Uint8Array(Buffer.from(trimmed, 'hex'));
  }

  // If the chain parser tried and failed, surface that error
  if (chainParseError !== undefined) {
    throw chainParseError;
  }

  throw new Error(
    'Invalid private key format. Expected 64-character hex string or chain-specific key format.',
  );
}

/**
 * Import a wallet from a raw private key (hex or chain-specific format).
 *
 * Derives the public key and address using the chain's derivation, then stores
 * the wallet in the database. No mnemonic or derivation path is associated.
 *
 * @param db - SQLite database connection
 * @param privateKeyInput - Private key in hex or chain-specific format
 * @param chain - Chain definition for key parsing and address derivation
 * @param alias - Optional custom alias for the wallet
 * @returns The imported wallet information and hex-encoded private key seed
 * @throws Error if the key format is invalid or the wallet already exists
 */
export function importFromPrivateKey(
  db: Database.Database,
  privateKeyInput: string,
  chain: ChainDefinition,
  alias?: string,
): ImportFromKeyResult {
  const seed = parsePrivateKeyInput(privateKeyInput, chain);
  const keypair = chain.walletDerivation.deriveFromRawKey(seed);

  const resolvedAlias = alias ?? generateAlias(db, chain.name, false);

  // Set as primary if no other wallet exists for this chain
  const isPrimary = getPrimaryWallet(db, chain.defaultChainId) === null;

  const wallet: WalletInfo = {
    chainId: chain.defaultChainId,
    address: keypair.address,
    derivationPath: null,
    isPrimary,
    isWatchOnly: false,
    alias: resolvedAlias,
  };

  insertWallet(db, wallet);

  const privateKeyHex = Buffer.from(seed).toString('hex');

  return { wallet, privateKeyHex };
}

/**
 * Remove a wallet record by address.
 *
 * Used for rollback when a subsequent operation (e.g., keystore save) fails
 * after the wallet was already inserted into the database.
 *
 * @param db - SQLite database connection
 * @param address - The wallet address to remove
 */
export function removeWallet(db: Database.Database, address: string): void {
  db.prepare('DELETE FROM wallets WHERE address = ?').run(address);
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
    INSERT INTO wallets (chain_id, address, derivation_path, is_primary, is_watch_only, alias)
    VALUES (@chain_id, @address, @derivation_path, @is_primary, @is_watch_only, @alias)
  `);

  try {
    stmt.run({
      chain_id: wallet.chainId,
      address: wallet.address,
      derivation_path: wallet.derivationPath,
      is_primary: wallet.isPrimary ? 1 : 0,
      is_watch_only: wallet.isWatchOnly ? 1 : 0,
      alias: wallet.alias,
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
    chainId: row.chain_id,
    address: row.address,
    derivationPath: row.derivation_path,
    isPrimary: row.is_primary === 1,
    isWatchOnly: row.is_watch_only === 1,
    alias:
      row.alias ??
      `${row.is_watch_only === 1 ? `${row.chain_id}-watch` : row.chain_id}-fallback-${row.id}`,
  };
}
