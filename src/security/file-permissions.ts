import { chmodSync, existsSync, lstatSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Owner-only read/write: the permission mode for all sensitive files. */
export const SECURE_FILE_MODE = 0o600;

/**
 * Set file permissions and verify the result.
 *
 * Rejects symlinks to prevent an attacker from redirecting chmod to an
 * attacker-controlled path (e.g., replacing keystore with a symlink to
 * a world-readable file).
 *
 * @param filePath - Absolute path to the file
 * @param mode - Permission mode (default: 0o600)
 * @throws Error if the file is a symlink, does not exist, or permissions could not be set
 */
export function enforceFilePermissions(filePath: string, mode: number = SECURE_FILE_MODE): void {
  // Check for symlinks BEFORE chmod to prevent TOCTOU redirect attacks.
  // lstatSync does NOT follow symlinks — it inspects the link itself.
  const linkStat = lstatSync(filePath);
  if (linkStat.isSymbolicLink()) {
    throw new Error(
      `Refusing to set permissions on "${filePath}": file is a symlink. ` +
        `This could be an attack — remove the symlink and re-create the file.`,
    );
  }

  chmodSync(filePath, mode);

  const actual = statSync(filePath).mode & 0o777;
  if (actual !== mode) {
    throw new Error(
      `Failed to set permissions on "${filePath}": expected ${mode.toString(8)}, got ${actual.toString(8)}`,
    );
  }
}

/** Owner-only rwx for directories. */
export const SECURE_DIR_MODE = 0o700;

/** Files that contain sensitive data and must be 0o600. */
export const SENSITIVE_FILES = ['keystore', 'config.toml', 'trades.db', 'session'] as const;

/**
 * Enforce secure permissions on the data directory and all sensitive files.
 *
 * - Directory: 0o700 (owner-only access — prevents file listing by others)
 * - Sensitive files: 0o600 (owner-only read/write)
 *
 * Silently skips files that do not yet exist (e.g., before first setup).
 *
 * @param dataDir - The OnlyFence data directory (e.g., ~/.onlyfence)
 */
export function ensureSecureDataDir(dataDir: string): void {
  // Enforce directory permissions first — blocks other users from listing files
  if (existsSync(dataDir)) {
    const dirStat = lstatSync(dataDir);
    if (dirStat.isSymbolicLink()) {
      throw new Error(
        `Refusing to use "${dataDir}": data directory is a symlink. ` +
          `Remove the symlink and re-create the directory.`,
      );
    }
    chmodSync(dataDir, SECURE_DIR_MODE);
  }

  for (const filename of SENSITIVE_FILES) {
    const filePath = join(dataDir, filename);
    if (existsSync(filePath)) {
      enforceFilePermissions(filePath, SECURE_FILE_MODE);
    }
  }
}
