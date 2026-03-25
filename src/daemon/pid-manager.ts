/**
 * PID file management for the daemon process.
 *
 * The PID file is used to:
 * 1. Prevent double-start of the daemon
 * 2. Allow the CLI to detect if the daemon is running
 * 3. Allow `fence stop` to find and signal the daemon
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ONLYFENCE_DIR } from '../config/loader.js';

/** Default PID file path. */
export const PID_PATH = join(ONLYFENCE_DIR, 'daemon.pid');

/**
 * Write the current process PID to the PID file.
 *
 * @throws Error if a daemon is already running (stale PID files are cleaned up)
 */
export function writePidFile(path: string = PID_PATH): void {
  const existing = readPidFile(path);
  if (existing !== null && isProcessAlive(existing)) {
    throw new Error(
      `Daemon is already running (PID ${String(existing)}).\n` +
        `  To stop it: fence stop\n` +
        `  PID file: ${path}`,
    );
  }

  // Clean up stale PID file if process is dead
  if (existing !== null) {
    removePidFile(path);
  }

  writeFileSync(path, String(process.pid), { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Read the PID from the PID file.
 *
 * @returns The PID number, or null if the file doesn't exist or is invalid
 */
export function readPidFile(path: string = PID_PATH): number | null {
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Remove the PID file.
 */
export function removePidFile(path: string = PID_PATH): void {
  try {
    unlinkSync(path);
  } catch {
    // File may already be gone
  }
}

/**
 * Check if the daemon is currently running.
 *
 * @returns true if a PID file exists and the process is alive
 */
export function isDaemonRunning(path: string = PID_PATH): boolean {
  const pid = readPidFile(path);
  return pid !== null && isProcessAlive(pid);
}

/**
 * Check if a process with the given PID is alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 checks existence without actually signaling
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
