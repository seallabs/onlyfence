/**
 * Environment variable sanitization to prevent code injection attacks.
 *
 * Strips dangerous environment variables that could be used to inject code
 * into the Node.js process or intercept network traffic. Must be called as
 * the very first action at CLI entry, before any imports or bootstrapping.
 */

/**
 * Environment variables that are dangerous in the context of a key-holding process.
 *
 * - NODE_OPTIONS: Can inject --require, --inspect, or V8 flags
 * - LD_PRELOAD / DYLD_INSERT_LIBRARIES: Shared library injection (Linux/macOS)
 * - NODE_PATH: Can redirect module resolution to attacker-controlled code
 * - HTTPS_PROXY / HTTP_PROXY: Can MITM oracle requests to manipulate prices
 * - NODE_EXTRA_CA_CERTS: Can inject a CA cert to MITM TLS connections to oracles
 */
export const DANGEROUS_ENV_VARS = [
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'NODE_PATH',
  'NODE_REDIRECT_WARNINGS',
  'NODE_REPL_EXTERNAL_MODULE',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'https_proxy',
  'http_proxy',
  'NODE_EXTRA_CA_CERTS',
] as const;

/**
 * Delete all dangerous environment variables from the current process.
 *
 * Returns the list of variables that were actually present and removed,
 * so callers can log what was stripped.
 */
export function sanitizeEnvironment(): readonly string[] {
  const removed: string[] = [];

  for (const key of DANGEROUS_ENV_VARS) {
    if (process.env[key] !== undefined) {
      removed.push(key);
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- env var keys are from a fixed allowlist
      delete process.env[key];
    }
  }

  return removed;
}
