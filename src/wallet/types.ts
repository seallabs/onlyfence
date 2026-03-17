/**
 * Information about a wallet stored in the OnlyFence database.
 */
export interface WalletInfo {
  readonly chain: string;
  readonly address: string;
  readonly derivationPath: string | null;
  readonly isPrimary: boolean;
  readonly isWatchOnly: boolean;
  readonly alias: string;
}

/**
 * Decrypted keystore data containing seed material and derived keys.
 */
export interface KeystoreData {
  /** BIP-39 mnemonic phrase (present for generated wallets) */
  readonly mnemonic?: string;

  /** Per-chain hex-encoded private keys (chain name -> hex private key) */
  readonly keys: Record<string, string>;
}

/**
 * Encrypted keystore format written to disk.
 * Uses scrypt for key derivation and AES-256-GCM for encryption.
 */
export interface EncryptedKeystore {
  readonly version: number;
  /** Hex-encoded scrypt salt */
  readonly salt: string;
  /** Hex-encoded AES-GCM initialization vector */
  readonly iv: string;
  /** Hex-encoded ciphertext */
  readonly ciphertext: string;
  /** Hex-encoded AES-GCM authentication tag */
  readonly tag: string;
}

/**
 * Row shape returned from the wallets SQLite table.
 */
export interface WalletRow {
  readonly id: number;
  readonly chain: string;
  readonly address: string;
  readonly derivation_path: string | null;
  readonly is_primary: number;
  readonly is_watch_only: number;
  readonly alias: string | null;
  readonly created_at: string;
}
