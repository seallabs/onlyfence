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
      const { isDaemonRunning } = await import('../../daemon/index.js');
      const { stopDaemonGracefully } = await import('../../daemon/stop-helper.js');

      if (!isDaemonRunning()) {
        console.error('No daemon is running.');
        process.exitCode = 1;
        return;
      }

      const result = await stopDaemonGracefully();

      switch (result.method) {
        case 'ipc':
          console.error('Daemon stopped.');
          break;
        case 'sigterm':
          console.error(`Sent SIGTERM to daemon (PID ${String(result.pid)}).`);
          break;
        case 'pid-cleanup':
          console.error(
            result.pid !== undefined
              ? `Daemon (PID ${String(result.pid)}) already exited. Cleaned up PID file.`
              : 'Cleaned up stale PID file.',
          );
          break;
      }
    });
}
