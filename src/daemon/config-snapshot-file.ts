/**
 * Signed config snapshot file for tamper detection.
 *
 * The daemon writes an HMAC-signed copy of its config at startup.
 * On next `fence start`, the snapshot is verified against the password
 * before comparing with the current on-disk config.
 *
 * This prevents a prompt-injected agent from:
 * 1. Modifying config.toml silently
 * 2. Stopping the daemon
 * 3. Telling the user to `fence start` (which would load tampered config)
 *
 * Attack defenses:
 * - Agent modifies snapshot file → HMAC verification fails → tampering warning
 * - Agent deletes snapshot file → full config shown for review
 * - Agent can't forge HMAC → doesn't know the password
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { ONLYFENCE_DIR } from '../config/loader.js';
import { enforceFilePermissions } from '../security/file-permissions.js';
import type { AppConfig } from '../types/config.js';

const SNAPSHOT_FILENAME = 'last-config.json';
const SNAPSHOT_PATH = join(ONLYFENCE_DIR, SNAPSHOT_FILENAME);

/** HMAC purpose string to domain-separate from keystore encryption. */
const HMAC_PURPOSE = 'onlyfence-config-snapshot-v1';

/** PBKDF2 iterations — high enough to resist GPU brute-force on the snapshot HMAC. */
const KDF_ITERATIONS = 100_000;
const KDF_KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/**
 * Snapshot stores the serialized JSON string (not the parsed object) to
 * guarantee HMAC round-trip stability — JSON key ordering is preserved
 * exactly as written.
 */
interface SignedSnapshot {
  readonly configJson: string;
  readonly salt: string;
  readonly hmac: string;
}

export type SnapshotVerification =
  | { readonly status: 'valid'; readonly config: AppConfig }
  | { readonly status: 'tampered' }
  | { readonly status: 'missing' };

/**
 * Write an HMAC-signed config snapshot to disk.
 *
 * Called by the daemon after successful startup so the next `fence start`
 * can detect config tampering.
 */
export function writeSignedSnapshot(config: AppConfig, password: string): void {
  const configJson = JSON.stringify(config);
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const hmac = computeHmac(configJson, password, salt);

  const snapshot: SignedSnapshot = { configJson, salt, hmac };
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot), 'utf-8');
  enforceFilePermissions(SNAPSHOT_PATH);
}

/**
 * Read and verify the signed config snapshot.
 *
 * @returns Verification result with the config (if valid), or status indicating
 *          the snapshot is tampered or missing.
 */
export function verifySignedSnapshot(password: string): SnapshotVerification {
  let raw: string;
  try {
    raw = readFileSync(SNAPSHOT_PATH, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing' };
    }
    throw err;
  }

  let snapshot: SignedSnapshot;
  try {
    snapshot = JSON.parse(raw) as SignedSnapshot;
  } catch {
    return { status: 'tampered' };
  }

  if (
    typeof snapshot.hmac !== 'string' ||
    typeof snapshot.configJson !== 'string' ||
    typeof snapshot.salt !== 'string'
  ) {
    return { status: 'tampered' };
  }

  const expected = computeHmac(snapshot.configJson, password, snapshot.salt);

  const hmacBuf = Buffer.from(snapshot.hmac, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (hmacBuf.length !== expectedBuf.length || !timingSafeEqual(hmacBuf, expectedBuf)) {
    return { status: 'tampered' };
  }

  try {
    return { status: 'valid', config: JSON.parse(snapshot.configJson) as AppConfig };
  } catch {
    return { status: 'tampered' };
  }
}

function computeHmac(data: string, password: string, salt: string): string {
  const saltBuf = Buffer.from(salt + HMAC_PURPOSE, 'utf-8');
  const key = pbkdf2Sync(password, saltBuf, KDF_ITERATIONS, KDF_KEY_LENGTH, 'sha256');
  return createHmac('sha256', key).update(data).digest('hex');
}
