/**
 * Centralized password resolution for CLI commands.
 *
 * All CLI commands that require a password should use `resolveCliPassword()`
 * to ensure consistent behavior across `start`, `reload`, `restart`, etc.
 *
 * Resolution order:
 * 1. FENCE_PASSWORD env var (deleted immediately after reading)
 * 2. --password-file flag or FENCE_PASSWORD_FILE env var
 * 3. Interactive terminal prompt (requires TTY)
 *
 * This module handles the CLI side only. The daemon process has its own
 * `resolvePassword()` in daemon/index.ts for reading stdin from the fork pipe.
 */

import { readFileSync } from 'node:fs';
import type { SecurePassword } from '../security/branded-types.js';
import {
  securePasswordFromEnv,
  securePasswordFromFile,
  securePasswordFromPrompt,
} from '../security/branded-types.js';

export interface PasswordResolutionOptions {
  /** Path to a file containing the password (e.g., Docker secret). */
  readonly passwordFile?: string | undefined;
  /** Prompt text shown when falling back to interactive input. */
  readonly prompt?: string | undefined;
}

/**
 * Resolve a password from the most secure available channel.
 *
 * @throws Error if no password source is available (no env var, no file, no TTY)
 */
export async function resolveCliPassword(
  options?: PasswordResolutionOptions,
): Promise<SecurePassword> {
  // 1. FENCE_PASSWORD env var (deleted on read)
  const envPassword = securePasswordFromEnv('FENCE_PASSWORD');
  if (envPassword !== undefined) {
    return envPassword;
  }

  // 2. --password-file flag or FENCE_PASSWORD_FILE env var
  const passwordFile = options?.passwordFile ?? process.env['FENCE_PASSWORD_FILE'];
  if (passwordFile !== undefined && passwordFile.length > 0) {
    const content = readFileSync(passwordFile, 'utf-8').trim();
    return securePasswordFromFile(content);
  }

  // 3. Interactive prompt (requires TTY)
  if (process.stdin.isTTY) {
    const { promptSecret } = await import('./prompt.js');
    const value = await promptSecret(options?.prompt ?? 'Enter keystore password: ', {
      stderr: true,
    });
    return securePasswordFromPrompt(value);
  }

  throw new Error(
    'Password required but no source available.\n' +
      '  Provide via one of:\n' +
      '    --password-file <path>      File containing the password\n' +
      '    FENCE_PASSWORD env var       Environment variable (deleted after read)\n' +
      '    FENCE_PASSWORD_FILE env var  Path to password file\n' +
      '    Interactive terminal         Run in a TTY session',
  );
}
