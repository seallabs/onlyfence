import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ONLYFENCE_DIR } from '../config/loader.js';
import { SECURE_DIR_MODE } from '../security/file-permissions.js';
import { toErrorMessage } from '../utils/index.js';
import { loadChainKeyBytes } from './signer.js';
import type { SessionData } from './types.js';

/** Current session file format version. */
const SESSION_VERSION = 1;

/** AES-256-GCM key length in bytes. */
const SESSION_KEY_LENGTH = 32;

/** AES-GCM IV length in bytes. */
const IV_LENGTH = 12;

/** Default session TTL: 4 hours in seconds. */
const DEFAULT_TTL_SECONDS = 14400;

/** Legacy single-chain session file path (kept for backward-compatible reads). */
const LEGACY_SESSION_PATH = join(ONLYFENCE_DIR, 'session');

/** Per-chain session file path. e.g. "session.sui-mainnet", "session.solana-mainnet" */
function sessionPath(chain: string): string {
  return join(ONLYFENCE_DIR, `session.${chain.replace(':', '-')}`);
}

/**
 * Create a new session for the given chain by decrypting the keystore and
 * re-encrypting the private key with a random session key.
 *
 * The master password is only used to decrypt the keystore — it is never
 * written to the session file. The session key is a random value.
 *
 * @param chain - Chain identifier (e.g., 'sui:mainnet', 'solana:mainnet')
 * @param password - Keystore password (used once, then discarded)
 * @param ttlSeconds - Session TTL in seconds (default: 14400 = 4h)
 * @throws Error if keystore decryption fails or chain key is missing
 */
export function createSession(
  chain: string,
  password: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): void {
  // Decrypt keystore → raw private key bytes
  const keyBytes = loadChainKeyBytes(chain, password);

  try {
    // Generate random session key and IV
    const sessionKey = randomBytes(SESSION_KEY_LENGTH);
    const iv = randomBytes(IV_LENGTH);

    // Encrypt raw key bytes with session key (AES-256-GCM)
    const cipher = createCipheriv('aes-256-gcm', sessionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(keyBytes), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Compute expiry
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    // Build session data
    const sessionData: SessionData = {
      version: SESSION_VERSION,
      session_key: sessionKey.toString('hex'),
      encrypted_blob: ciphertext.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      chain,
      expires_at: expiresAt,
    };

    const path = sessionPath(chain);

    // Write session file with restricted permissions (owner read/write only)
    mkdirSync(dirname(path), { recursive: true, mode: SECURE_DIR_MODE });
    writeFileSync(path, JSON.stringify(sessionData, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } finally {
    // Zero raw key bytes from memory
    keyBytes.fill(0);
  }
}

/**
 * Load the raw private key bytes from an active session for the given chain.
 *
 * Tries the per-chain session file first, then falls back to the legacy
 * single-session file for users who haven't re-unlocked since the upgrade.
 *
 * @param chain - Chain identifier (must match the session's chain)
 * @returns Raw private key bytes (Uint8Array)
 * @throws Error if session is missing, expired, chain-mismatched, or corrupted
 */
export function loadSessionKeyBytes(chain: string): Uint8Array {
  // Try per-chain path first, then legacy path (backward compat)
  const pathsToTry = [sessionPath(chain), LEGACY_SESSION_PATH];

  for (const path of pathsToTry) {
    let content: string;
    try {
      content = readFileSync(path, 'utf-8');
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        continue; // Try next path
      }
      throw new Error(`Failed to read session file: ${toErrorMessage(err)}`);
    }

    // Parse and validate
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      throw new Error('Session file is corrupted: invalid JSON.');
    }

    validateSessionData(data);

    // Check chain match
    if (data.chain !== chain) {
      throw new Error(
        `Session was created for chain "${data.chain}", but "${chain}" was requested. Run: fence unlock`,
      );
    }

    // Check expiry
    const expiresAt = new Date(data.expires_at).getTime();
    if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
      throw new Error('Session expired. Unlock again: fence unlock');
    }

    // Decrypt the blob
    const sessionKey = Buffer.from(data.session_key, 'hex');
    const iv = Buffer.from(data.iv, 'hex');
    const ciphertext = Buffer.from(data.encrypted_blob, 'hex');
    const tag = Buffer.from(data.tag, 'hex');

    const decipher = createDecipheriv('aes-256-gcm', sessionKey, iv);
    decipher.setAuthTag(tag);

    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new Error('Session file is corrupted or tampered with.');
    }
  }

  // Neither per-chain nor legacy session found
  throw new Error('No active session. Unlock your wallet first: fence unlock');
}

/**
 * Destroy all active sessions (per-chain and legacy).
 *
 * Overwrites each session file with zeros before deleting it for secure cleanup.
 * Idempotent: does not throw if no sessions exist.
 */
export function destroySession(): void {
  const paths: string[] = [LEGACY_SESSION_PATH];

  // Collect per-chain session files
  try {
    const files = readdirSync(ONLYFENCE_DIR);
    for (const file of files) {
      if (file.startsWith('session.')) {
        paths.push(join(ONLYFENCE_DIR, file));
      }
    }
  } catch {
    // ONLYFENCE_DIR doesn't exist — nothing to destroy
  }

  for (const path of paths) {
    try {
      const stat = statSync(path);
      // Overwrite with zeros before deleting (secure delete)
      writeFileSync(path, Buffer.alloc(stat.size, 0));
      unlinkSync(path);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        continue; // Already gone — that's fine
      }
      throw new Error(`Failed to destroy session: ${toErrorMessage(err)}`);
    }
  }
}

/**
 * Check if any valid (non-expired) session exists across all chains.
 *
 * This function never throws. Returns false on any error.
 */
export function hasActiveSession(): boolean {
  const paths: string[] = [LEGACY_SESSION_PATH];

  try {
    const files = readdirSync(ONLYFENCE_DIR);
    for (const file of files) {
      if (file.startsWith('session.')) {
        paths.push(join(ONLYFENCE_DIR, file));
      }
    }
  } catch {
    // ONLYFENCE_DIR doesn't exist
  }

  for (const path of paths) {
    try {
      const content = readFileSync(path, 'utf-8');
      const data = JSON.parse(content) as Record<string, unknown>;
      if (typeof data['expires_at'] !== 'string') continue;
      if (new Date(data['expires_at']).getTime() > Date.now()) return true;
    } catch {
      // File not found or invalid — skip
    }
  }

  return false;
}

/**
 * Validate that a parsed object has the expected SessionData shape.
 *
 * @throws Error if the shape is invalid
 */
function validateSessionData(data: unknown): asserts data is SessionData {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Session file has invalid format: expected an object.');
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj['version'] !== 'number') {
    throw new Error('Session file is corrupted: missing or invalid "version" field.');
  }
  if (obj['version'] !== SESSION_VERSION) {
    throw new Error(
      `Unsupported session version ${String(obj['version'])}. Expected version ${String(SESSION_VERSION)}.`,
    );
  }

  const requiredStringFields = [
    'session_key',
    'encrypted_blob',
    'iv',
    'tag',
    'chain',
    'expires_at',
  ] as const;

  for (const field of requiredStringFields) {
    if (typeof obj[field] !== 'string' || obj[field].length === 0) {
      throw new Error(`Session file is corrupted: missing or invalid "${field}" field.`);
    }
  }

  // Validate hex field lengths
  if ((obj['session_key'] as string).length !== SESSION_KEY_LENGTH * 2) {
    throw new Error('Session file is corrupted: session_key has invalid length.');
  }
  if ((obj['iv'] as string).length !== IV_LENGTH * 2) {
    throw new Error('Session file is corrupted: iv has invalid length.');
  }
  // AES-256-GCM auth tag is always 16 bytes (32 hex chars)
  if ((obj['tag'] as string).length !== 32) {
    throw new Error('Session file is corrupted: tag has invalid length.');
  }
}
