/**
 * Information about a wallet stored in the OnlyFence database.
 */
export interface WalletInfo {
  readonly chainId: string;
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
 * Session data stored in ~/.onlyfence/session.
 *
 * Created by `fence unlock`, consumed by `fence swap`, destroyed by `fence lock`.
 * The session key is a random value — it is NOT the keystore password.
 */
export interface SessionData {
  readonly version: number;
  /** Hex-encoded 32-byte random session key */
  readonly session_key: string;
  /** Hex-encoded AES-256-GCM ciphertext of the raw private key */
  readonly encrypted_blob: string;
  /** Hex-encoded 12-byte AES-GCM initialization vector */
  readonly iv: string;
  /** Hex-encoded 16-byte AES-GCM authentication tag */
  readonly tag: string;
  /** Chain identifier used in keystore lookup (e.g., 'sui:mainnet') */
  readonly chain: string;
  /** ISO 8601 timestamp when the session expires */
  readonly expires_at: string;
}

/**
 * Row shape returned from the wallets SQLite table.
 */
export interface WalletRow {
  readonly id: number;
  readonly chain_id: string;
  readonly address: string;
  readonly derivation_path: string | null;
  readonly is_primary: number;
  readonly is_watch_only: number;
  readonly alias: string | null;
  readonly created_at: string;
}
