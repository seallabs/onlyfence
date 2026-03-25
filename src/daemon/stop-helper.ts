/**
 * Shared daemon stop logic used by both `fence stop` and `fence uninstall`.
 *
 * Two-phase approach:
 * 1. IPC stop request — daemon confirms with `ok: true`
 * 2. Fallback SIGTERM via PID file if IPC fails
 */

import { toErrorMessage } from '../utils/index.js';
import { DaemonClient } from './client.js';
import { detectExecutionMode } from './detect.js';
import { readPidFile, removePidFile } from './pid-manager.js';

export interface StopResult {
  readonly method: 'ipc' | 'sigterm' | 'pid-cleanup';
  readonly pid?: number;
}

/**
 * Stop the running daemon gracefully.
 *
 * @returns How the daemon was stopped
 * @throws Error if the daemon could not be stopped
 */
export async function stopDaemonGracefully(): Promise<StopResult> {
  const mode = detectExecutionMode();
  const addr = mode.mode === 'daemon-client' ? mode.address : '';

  // Phase 1: Try IPC stop
  try {
    const client = new DaemonClient(addr);
    const response = await client.send('stop');
    if (response.ok) {
      return { method: 'ipc' };
    }
    // Daemon rejected the stop — fall through to SIGTERM
  } catch {
    // IPC failed (socket gone, connection refused) — fall through to SIGTERM
  }

  // Phase 2: Fallback to SIGTERM via PID
  const pid = readPidFile();
  if (pid === null) {
    return { method: 'pid-cleanup' };
  }

  try {
    process.kill(pid, 'SIGTERM');
    removePidFile();
    return { method: 'sigterm', pid };
  } catch (err: unknown) {
    // ESRCH = process already gone — clean up PID file
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ESRCH') {
      removePidFile();
      return { method: 'pid-cleanup', pid };
    }
    // EPERM or other real error — surface it
    removePidFile();
    throw new Error(`Failed to signal daemon (PID ${String(pid)}): ${toErrorMessage(err)}`);
  }
}
