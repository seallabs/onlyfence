/**
 * Shared utility for forking the daemon in detached mode.
 *
 * Password is passed via stdin pipe — NEVER as a CLI argument
 * (visible in `ps aux`) or env var (readable via /proc/environ).
 */

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Resolve the CLI entry file path relative to this module. */
const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'index.js');

export interface ForkDaemonOptions {
  readonly password: string;
  readonly tcpHost: string;
  readonly tcpPort: string;
  readonly allowRemote?: boolean;
}

/**
 * Fork the daemon as a detached background process.
 *
 * @returns The child process PID (or undefined if fork failed)
 */
export function forkDaemonDetached(options: ForkDaemonOptions): number | undefined {
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
      stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
    },
  );

  // Send password over stdin pipe, then close it
  child.stdin?.write(options.password + '\n');
  child.stdin?.end();
  child.unref();

  return child.pid;
}
