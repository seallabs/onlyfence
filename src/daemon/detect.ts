/**
 * Auto-detection of daemon execution mode.
 *
 * Determines whether the CLI should execute in-process or route
 * through the daemon. The detection follows a priority order:
 *
 * 1. --addr flag (per-command override)
 * 2. FENCE_DAEMON_ADDR env var
 * 3. ~/.onlyfence/signer.sock exists + PID alive
 * 4. Fallback: in-process
 *
 * Critical rule: if the daemon is running, we MUST route through it.
 * There is no --in-process bypass.
 */

import { join } from 'node:path';
import { ONLYFENCE_DIR } from '../config/loader.js';
import { isDaemonRunning } from './pid-manager.js';

export type ExecutionMode =
  | { readonly mode: 'in-process' }
  | { readonly mode: 'daemon-client'; readonly address: string };

/** Default Unix socket path. */
export const SOCKET_PATH = join(ONLYFENCE_DIR, 'signer.sock');

/**
 * Detect whether to run in-process or route through the daemon.
 *
 * @param addrFlag - Optional --addr flag from the command
 * @returns The execution mode with daemon address if applicable
 */
export function detectExecutionMode(addrFlag?: string): ExecutionMode {
  // Priority 1: Explicit --addr flag
  if (addrFlag !== undefined && addrFlag.length > 0) {
    return { mode: 'daemon-client', address: addrFlag };
  }

  // Priority 2: FENCE_DAEMON_ADDR environment variable
  const envAddr = process.env['FENCE_DAEMON_ADDR'];
  if (envAddr !== undefined && envAddr.length > 0) {
    return { mode: 'daemon-client', address: envAddr };
  }

  // Priority 3: Unix socket exists and daemon PID is alive
  if (isDaemonRunning()) {
    return { mode: 'daemon-client', address: SOCKET_PATH };
  }

  // Fallback: in-process execution
  return { mode: 'in-process' };
}
