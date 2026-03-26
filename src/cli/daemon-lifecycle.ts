/**
 * Shared helpers for daemon lifecycle commands (start, restart).
 *
 * Centralizes confirmation prompts and the fork-vs-foreground start logic
 * so `start` and `restart` stay DRY.
 */

import type { AppConfig } from '../types/config.js';
import type { SecurePassword } from '../security/branded-types.js';

/** Options shared by start and restart for launching a daemon. */
export interface DaemonLaunchOptions {
  readonly password: SecurePassword;
  readonly detach: boolean;
  readonly tcpHost: string;
  readonly tcpPort: string;
  readonly allowRemote: boolean;
}

/**
 * Start the daemon in foreground or detached mode.
 *
 * Encapsulates the fork-vs-foreground decision so callers don't duplicate it.
 */
export async function launchDaemon(options: DaemonLaunchOptions): Promise<void> {
  if (options.detach) {
    const { forkDaemonDetached } = await import('./daemon-fork.js');
    const pid = await forkDaemonDetached({
      password: options.password as string,
      tcpHost: options.tcpHost,
      tcpPort: options.tcpPort,
      allowRemote: options.allowRemote,
    });
    process.stderr.write(`Daemon started in background (PID ${String(pid)})\n`);
    process.stderr.write('  Check status:  fence status\n');
    process.stderr.write('  Stop daemon:   fence stop\n');
    process.exit(0);
  } else {
    const { startDaemon } = await import('../daemon/index.js');
    await startDaemon({
      password: options.password,
      tcpHost: options.tcpHost,
      tcpPort: parseInt(options.tcpPort, 10),
      allowRemote: options.allowRemote,
    });
  }
}

/**
 * Prompt for yes/no confirmation. Exits if the user declines.
 * Skips the prompt entirely if `skipConfirm` is true (--yes flag).
 */
export async function confirmOrExit(prompt: string, skipConfirm: boolean): Promise<void> {
  if (skipConfirm) return;

  if (!process.stdin.isTTY) {
    console.error('Cannot confirm interactively (not a TTY). Use --yes to skip confirmation.');
    process.exit(1);
  }

  const { promptYesNo } = await import('./prompt.js');
  const answer = await promptYesNo(prompt);
  if (answer !== 'y') {
    console.error('Cancelled.');
    process.exit(0);
  }
}

/** Print the full config as formatted JSON to stderr. */
export function showFullConfig(config: AppConfig): void {
  process.stderr.write(JSON.stringify(config, null, 2) + '\n\n');
}
