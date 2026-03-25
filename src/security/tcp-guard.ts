/**
 * TCP loopback enforcement to prevent accidental network exposure.
 *
 * The daemon should only listen on loopback addresses unless explicitly
 * opted into remote access via --allow-remote.
 */

/** Addresses considered safe loopback destinations. */
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Assert that a TCP host address is loopback-only.
 *
 * @param host - The host address to check
 * @param allowRemote - If true, skip the check entirely
 * @throws Error if the host is non-loopback and allowRemote is false
 */
export function assertLoopbackOnly(host: string, allowRemote: boolean): void {
  if (allowRemote) return;

  if (!LOOPBACK_ADDRESSES.has(host)) {
    throw new Error(
      `Refusing to bind to non-loopback address "${host}".\n` +
        `  Reason:  Binding to a network-reachable address exposes the daemon to remote connections.\n` +
        `  To fix:  Use 127.0.0.1, or pass --allow-remote if you understand the risk.`,
    );
  }
}
