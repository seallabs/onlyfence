import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ONLYFENCE_DIR } from '../config/loader.js';
import type { KeystoreData, EncryptedKeystore } from './types.js';
import { toErrorMessage } from '../utils/index.js';
import { enforceFilePermissions, SECURE_DIR_MODE } from '../security/file-permissions.js';

/** Current keystore format version. */
const KEYSTORE_VERSION = 1;

/** scrypt parameters: N=2^14 (16384), r=8, p=1, key length=32 bytes. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

/** AES-GCM IV length in bytes. */
const IV_LENGTH = 12;

/** Salt length in bytes. */
const SALT_LENGTH = 32;

/** Default keystore file path. */
export const DEFAULT_KEYSTORE_PATH = join(ONLYFENCE_DIR, 'keystore');

/** Minimum password length for keystore encryption. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Encrypt keystore data with a password and write to disk.
 *
 * Uses scrypt for key derivation and AES-256-GCM for authenticated encryption.
 *
 * @param data - The plaintext keystore data to encrypt
 * @param password - User-provided password for encryption
 * @param path - File path to write the encrypted keystore
 * @throws Error if the file cannot be written
 */
export function saveKeystore(
  data: KeystoreData,
  password: string,
  path: string = DEFAULT_KEYSTORE_PATH,
): void {
  const encrypted = encryptKeystoreData(data, password);

  mkdirSync(dirname(path), { recursive: true, mode: SECURE_DIR_MODE });
  writeFileSync(path, JSON.stringify(encrypted, null, 2), 'utf-8');
  enforceFilePermissions(path);
}

/**
 * Read an encrypted keystore from disk and decrypt it with the given password.
 *
 * @param password - User-provided password for decryption
 * @param path - File path to read the encrypted keystore from
 * @returns Decrypted keystore data
 * @throws Error if the file is missing, corrupted, or the password is wrong
 */
export function loadKeystore(password: string, path: string = DEFAULT_KEYSTORE_PATH): KeystoreData {
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      throw new Error(
        `Keystore file not found at "${path}". Run "fence setup" to create a wallet.`,
      );
    }
    throw new Error(`Failed to read keystore at "${path}": ${toErrorMessage(err)}`);
  }

  let encrypted: EncryptedKeystore;
  try {
    encrypted = JSON.parse(content) as EncryptedKeystore;
  } catch {
    throw new Error(`Keystore file at "${path}" is corrupted: invalid JSON.`);
  }

  validateEncryptedKeystore(encrypted);

  return decryptKeystoreData(encrypted, password);
}

/**
 * Encrypt keystore data into an EncryptedKeystore structure.
 *
 * @param data - Plaintext keystore data
 * @param password - Password for encryption
 * @returns Encrypted keystore structure
 */
export function encryptKeystoreData(data: KeystoreData, password: string): EncryptedKeystore {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);

  const derivedKey = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
  const plaintext = JSON.stringify(data);

  const ciphertextBuf = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: KEYSTORE_VERSION,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    ciphertext: ciphertextBuf.toString('hex'),
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt an EncryptedKeystore structure with the given password.
 *
 * @param encrypted - The encrypted keystore structure
 * @param password - Password for decryption
 * @returns Decrypted keystore data
 * @throws Error if the password is wrong or data is corrupted
 */
export function decryptKeystoreData(encrypted: EncryptedKeystore, password: string): KeystoreData {
  const salt = Buffer.from(encrypted.salt, 'hex');
  const iv = Buffer.from(encrypted.iv, 'hex');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'hex');
  const tag = Buffer.from(encrypted.tag, 'hex');

  const derivedKey = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(tag);

  let plaintext: string;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
  } catch {
    throw new Error('Failed to decrypt keystore: wrong password or corrupted data.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error('Decrypted keystore contains invalid JSON. The keystore may be corrupted.');
  }

  validateKeystoreData(parsed);

  return parsed;
}

/**
 * Validate that a parsed object has the expected KeystoreData shape.
 *
 * @param data - Parsed object to validate
 * @throws Error if the shape is invalid
 */
function validateKeystoreData(data: unknown): asserts data is KeystoreData {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Decrypted keystore has invalid format: expected an object.');
  }

  const obj = data as Record<string, unknown>;

  if (!('keys' in obj) || typeof obj['keys'] !== 'object' || obj['keys'] === null) {
    throw new Error('Decrypted keystore has invalid format: missing or invalid "keys" field.');
  }

  const keys = obj['keys'] as Record<string, unknown>;
  for (const [chain, value] of Object.entries(keys)) {
    if (typeof value !== 'string') {
      throw new Error(
        `Decrypted keystore has invalid format: key for chain "${chain}" must be a string.`,
      );
    }
  }

  if ('mnemonic' in obj && typeof obj['mnemonic'] !== 'string') {
    throw new Error('Decrypted keystore has invalid format: "mnemonic" must be a string.');
  }
}

/**
 * Validate that an object has the expected EncryptedKeystore shape.
 *
 * @param data - Object to validate
 * @throws Error if the shape is invalid
 */
function validateEncryptedKeystore(data: EncryptedKeystore): void {
  if (typeof data.version !== 'number') {
    throw new Error('Keystore file is corrupted: missing or invalid "version" field.');
  }
  if (data.version !== KEYSTORE_VERSION) {
    throw new Error(
      `Unsupported keystore version ${String(data.version)}. Expected version ${String(KEYSTORE_VERSION)}.`,
    );
  }
  for (const field of ['salt', 'iv', 'ciphertext', 'tag'] as const) {
    if (typeof data[field] !== 'string' || data[field].length === 0) {
      throw new Error(`Keystore file is corrupted: missing or invalid "${field}" field.`);
    }
  }
}
