/**
 * Runtime security assertions that fail fast on invariant violations.
 *
 * These run at process entry and daemon startup to catch misconfigurations
 * before they can be exploited. Each assertion throws with an actionable
 * error message.
 */

import { existsSync, lstatSync } from 'node:fs';

/**
 * Assert that no password appears in the current process argv.
 *
 * Should be called at process entry. Prevents accidental leaks where
 * a password is passed as a CLI argument (visible in `ps aux`).
 */
export function assertNoPasswordInArgv(): void {
  for (const arg of process.argv) {
    if (arg === '--password' || arg === '-p') {
      throw new Error(
        'SECURITY: Password detected in process arguments.\n' +
          '  Passwords in argv are visible to all local users via `ps aux`.\n' +
          '  Use interactive prompt, FENCE_PASSWORD_FILE, or stdin pipe instead.\n' +
          '  This is a bug — please report it.',
      );
    }
  }
}

/**
 * Assert that the data directory is not a symlink.
 *
 * A symlinked data directory could redirect reads/writes to an
 * attacker-controlled location.
 */
export function assertDataDirNotSymlink(dataDir: string): void {
  if (existsSync(dataDir) && lstatSync(dataDir).isSymbolicLink()) {
    throw new Error(
      `SECURITY: Data directory "${dataDir}" is a symlink.\n` +
        `  This could redirect sensitive data to an attacker-controlled location.\n` +
        `  Remove the symlink and re-create as a real directory.`,
    );
  }
}
