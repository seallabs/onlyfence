import type { Command } from 'commander';
import { toErrorMessage } from '../../utils/index.js';
import type { AppConfig } from '../../types/config.js';

/**
 * Register the `fence restart` command.
 *
 * Stops the running daemon, shows config diff for user review, then starts
 * a new daemon with the on-disk config — all authenticated with a single
 * password prompt.
 */
export function registerRestartCommand(program: Command): void {
  program
    .command('restart')
    .description('Restart the daemon with new config (shows diff, requires password)')
    .option('-d, --detach', 'Run restarted daemon in background', false)
    .option('--tcp-host <host>', 'TCP bind address', '127.0.0.1')
    .option('--tcp-port <port>', 'TCP port', '19876')
    .option('--allow-remote', 'Allow non-loopback TCP connections', false)
    .option('--password-file <path>', 'Read password from file instead of prompting')
    .option('-y, --yes', 'Skip confirmation prompt (still requires password)', false)
    .action(
      async (options: {
        detach: boolean;
        tcpHost: string;
        tcpPort: string;
        allowRemote: boolean;
        passwordFile?: string;
        yes: boolean;
      }) => {
        const { isDaemonRunning, DaemonClient, detectExecutionMode } =
          await import('../../daemon/index.js');

        if (!isDaemonRunning()) {
          console.error(
            'No daemon is running. Use `fence start` to start one.\n' +
              '  If you want to start a fresh daemon, run:\n' +
              '    fence start          Start in foreground\n' +
              '    fence start --detach Start in background',
          );
          process.exitCode = 1;
          return;
        }

        // Authenticate first (consistent with `fence start`)
        const { resolveCliPassword } = await import('../password.js');
        const password = await resolveCliPassword({ passwordFile: options.passwordFile });

        // Fetch daemon's current config and compare with on-disk config
        const mode = detectExecutionMode();
        const addr = mode.mode === 'daemon-client' ? mode.address : '';
        const client = new DaemonClient(addr);

        const { loadConfig } = await import('../../config/loader.js');
        const { computeConfigDiff, formatConfigDiff } = await import('../config-diff.js');
        const { confirmOrExit } = await import('../daemon-lifecycle.js');

        let daemonConfig: AppConfig | undefined;
        try {
          const configResponse = await client.send('config');
          if (configResponse.ok) {
            daemonConfig = (configResponse.data as { config: AppConfig }).config;
          }
        } catch {
          // Daemon might not support 'config' request (older version) — proceed without diff
        }

        let diskConfig: AppConfig;
        try {
          diskConfig = loadConfig();
        } catch (err: unknown) {
          console.error(`Failed to read on-disk config: ${toErrorMessage(err)}`);
          process.exitCode = 1;
          return;
        }

        // Show diff if we could fetch daemon config
        if (daemonConfig !== undefined) {
          const changes = computeConfigDiff(daemonConfig, diskConfig);
          if (changes.length > 0) {
            process.stderr.write(formatConfigDiff(changes));
          } else {
            process.stderr.write('Config unchanged (daemon config matches disk).\n\n');
          }
        }

        await confirmOrExit('Restart daemon with this config? [y/N] ', options.yes);

        // Stop the running daemon
        const { stopDaemonGracefully } = await import('../../daemon/index.js');
        try {
          const stopResult = await stopDaemonGracefully();
          switch (stopResult.method) {
            case 'ipc':
              process.stderr.write('Daemon stopped.\n');
              break;
            case 'sigterm':
              process.stderr.write(`Sent SIGTERM to daemon (PID ${String(stopResult.pid)}).\n`);
              break;
            case 'pid-cleanup':
              process.stderr.write('Daemon already exited. Cleaned up.\n');
              break;
          }
        } catch (err: unknown) {
          console.error(`Failed to stop daemon: ${toErrorMessage(err)}`);
          process.exitCode = 1;
          return;
        }

        // Start the new daemon
        const { launchDaemon } = await import('../daemon-lifecycle.js');
        await launchDaemon({ password, ...options });
      },
    );
}
