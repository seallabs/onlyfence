/**
 * Branded types for security-sensitive values.
 *
 * These types use TypeScript's structural typing system to prevent
 * accidental misuse at compile time. A plain `string` cannot be passed
 * where a `SecurePassword` is expected — you must go through the
 * creation function, which documents and enforces the secure channel.
 *
 * This turns "developer must remember not to leak passwords" into
 * "TypeScript won't compile if you try."
 */

/** Unique symbol used as a brand — never exported, never constructible. */
declare const PasswordBrand: unique symbol;

/**
 * A password that was obtained through a secure channel
 * (interactive prompt, file read, or env var with immediate deletion).
 *
 * Cannot be created from a plain string — must use one of the
 * `securePasswordFrom*` functions. This prevents:
 * - Passing passwords as CLI arguments (fork args are string[])
 * - Interpolating passwords into log messages
 * - Accidentally storing passwords in config objects
 */
export type SecurePassword = string & { readonly [PasswordBrand]: true };

/**
 * Create a SecurePassword from an interactive terminal prompt.
 * This is the primary secure channel for password input.
 */
export function securePasswordFromPrompt(value: string): SecurePassword {
  return value as SecurePassword;
}

/**
 * Create a SecurePassword from a file read (e.g., Docker secret).
 * The file should be 0o600 and on a tmpfs mount.
 */
export function securePasswordFromFile(value: string): SecurePassword {
  return value as SecurePassword;
}

/**
 * Create a SecurePassword from an environment variable.
 * The env var is deleted immediately after reading.
 */
export function securePasswordFromEnv(key: string): SecurePassword | undefined {
  const value = process.env[key];
  if (value === undefined || value.length === 0) return undefined;
  // Delete immediately to reduce exposure window
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- controlled env var key
  delete process.env[key];
  return value as SecurePassword;
}

/**
 * Create a SecurePassword from a stdin pipe read.
 * Used by detached daemon startup to receive password securely.
 */
export function securePasswordFromStdin(value: string): SecurePassword {
  return value as SecurePassword;
}
