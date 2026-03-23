import type { Command } from 'commander';

/**
 * Register the `fence stop` command.
 *
 * Sends a stop request to the running daemon.
 */
export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop the running OnlyFence daemon')
    .action(async () => {
      const { isDaemonRunning, DaemonClient } = await import('../../daemon/index.js');
      const { readPidFile, removePidFile } = await import('../../daemon/pid-manager.js');
      const { SOCKET_PATH } = await import('../../daemon/detect.js');

      if (!isDaemonRunning()) {
        console.error('No daemon is running.');
        process.exitCode = 1;
        return;
      }

      // Try IPC stop first
      try {
        const addr = process.env['FENCE_DAEMON_ADDR'] ?? SOCKET_PATH;
        const client = new DaemonClient(addr);
        const response = await client.send('stop');

        if (response.ok) {
          console.error('Daemon stopped.');
          return;
        }
      } catch {
        // IPC failed, fall back to SIGTERM
      }

      // Fallback: send SIGTERM to PID
      const pid = readPidFile();
      if (pid !== null) {
        try {
          process.kill(pid, 'SIGTERM');
          console.error(`Sent SIGTERM to daemon (PID ${String(pid)})`);
          removePidFile();
        } catch {
          console.error(`Failed to signal daemon (PID ${String(pid)}). Cleaning up PID file.`);
          removePidFile();
        }
      }
    });
}
