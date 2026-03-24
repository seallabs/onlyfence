import type { Command } from 'commander';
import type { SecurePassword } from '../../security/branded-types.js';

/**
 * Register the `fence start` command.
 *
 * Starts the OnlyFence daemon in foreground or detached mode.
 */
export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start the OnlyFence daemon (promotes to Tier 1)')
    .option('-d, --detach', 'Run daemon in background', false)
    .option('--tcp-host <host>', 'TCP bind address', '127.0.0.1')
    .option('--tcp-port <port>', 'TCP port', '19876')
    .option('--allow-remote', 'Allow non-loopback TCP connections', false)
    .action(
      async (options: {
        detach: boolean;
        tcpHost: string;
        tcpPort: string;
        allowRemote: boolean;
      }) => {
        if (options.detach) {
          const { promptPassword } = await import('../password-prompt.js');
          const password = await promptPassword('Enter keystore password: ');
          const { forkDaemonDetached } = await import('../daemon-fork.js');
          const pid = await forkDaemonDetached({ password, ...options });
          process.stderr.write(`Daemon started in background (PID ${String(pid)})\n`);
          process.stderr.write('  Check status:  fence status\n');
          process.stderr.write('  Stop daemon:   fence stop\n');
        } else {
          const { startDaemon } = await import('../../daemon/index.js');
          const { securePasswordFromPrompt } = await import('../../security/branded-types.js');
          // Only prompt if no env var is set AND stdin is a TTY.
          // When forked in detached mode, stdin is a pipe carrying the password —
          // startDaemon's resolvePassword() reads it via readStdinLine().
          let password: SecurePassword | undefined;
          if (
            process.stdin.isTTY &&
            process.env['FENCE_PASSWORD'] === undefined &&
            process.env['FENCE_PASSWORD_FILE'] === undefined
          ) {
            const { promptPassword } = await import('../password-prompt.js');
            password = securePasswordFromPrompt(await promptPassword('Enter keystore password: '));
          }
          await startDaemon({
            ...(password !== undefined ? { password } : {}),
            tcpHost: options.tcpHost,
            tcpPort: parseInt(options.tcpPort, 10),
            allowRemote: options.allowRemote,
          });
        }
      },
    );
}
