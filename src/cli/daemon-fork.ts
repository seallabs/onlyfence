/**
 * Shared utility for forking the daemon in detached mode.
 *
 * Password is passed via stdin pipe — NEVER as a CLI argument
 * (visible in `ps aux`) or env var (readable via /proc/environ).
 */

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isDaemonReadyMessage } from '../daemon/protocol.js';

/** Resolve the CLI entry file path relative to this module. */
const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'index.js');

/** Timeout (ms) to wait for the daemon to signal readiness. */
const READY_TIMEOUT_MS = 30_000;

export interface ForkDaemonOptions {
  readonly password: string;
  readonly tcpHost: string;
  readonly tcpPort: string;
  readonly allowRemote?: boolean;
}

/**
 * Fork the daemon as a detached background process and wait for it to be ready.
 *
 * The child sends a `{ type: 'daemon-ready' }` IPC message once it has
 * started its servers and written the PID file. This function resolves
 * only after receiving that message, so the caller can safely report success.
 *
 * @returns The child process PID
 * @throws Error if the daemon fails to start within the timeout
 */
export async function forkDaemonDetached(options: ForkDaemonOptions): Promise<number> {
  const child = fork(
    CLI_ENTRY,
    [
      'start',
      '--tcp-host',
      options.tcpHost,
      '--tcp-port',
      options.tcpPort,
      ...(options.allowRemote === true ? ['--allow-remote'] : []),
    ],
    {
      detached: true,
      stdio: ['pipe', 'ignore', 'pipe', 'ipc'],
    },
  );

  // Send password over stdin pipe, then close it
  child.stdin?.write(options.password + '\n');
  child.stdin?.end();

  // Collect stderr from child so we can surface errors (capped to prevent OOM)
  const MAX_STDERR_BYTES = 10_240;
  let stderrOutput = '';
  child.stderr?.setEncoding('utf-8');
  child.stderr?.on('data', (chunk: string) => {
    const remaining = MAX_STDERR_BYTES - stderrOutput.length;
    if (remaining > 0) {
      stderrOutput += chunk.slice(0, remaining);
    }
  });

  return new Promise<number>((resolve, reject) => {
    let settled = false;

    /** Clear timer, detach all handles, and mark settled. */
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timeout);
      child.stderr?.removeAllListeners();
      child.stderr?.destroy();
      child.removeAllListeners();
      if (child.connected) child.disconnect();
      child.unref();
      return true;
    };

    const timeout = setTimeout(() => {
      if (settle()) {
        reject(new Error(`Daemon did not become ready within ${String(READY_TIMEOUT_MS / 1000)}s`));
      }
    }, READY_TIMEOUT_MS);

    child.on('message', (msg: unknown) => {
      if (isDaemonReadyMessage(msg) && settle()) {
        const pid = child.pid;
        if (pid === undefined) {
          reject(new Error('Daemon reported ready but child PID is unavailable'));
          return;
        }
        resolve(pid);
      }
    });

    child.on('exit', (code) => {
      if (settle()) {
        const detail = stderrOutput.trim();
        reject(
          new Error(
            `Daemon exited before becoming ready (code ${String(code)})` +
              (detail.length > 0 ? `:\n${detail}` : ''),
          ),
        );
      }
    });

    child.on('error', (err) => {
      if (settle()) {
        const detail = stderrOutput.trim();
        reject(
          new Error(
            `Failed to fork daemon: ${err.message}` + (detail.length > 0 ? `:\n${detail}` : ''),
          ),
        );
      }
    });
  });
}
