import type { Command } from 'commander';

/**
 * Register the `fence quickstart` command.
 *
 * Combined flow: setup wallet → start daemon in one interactive session.
 */
export function registerQuickstartCommand(program: Command): void {
  program
    .command('quickstart')
    .description('Set up wallet and start daemon in one step')
    .option('-d, --detach', 'Run daemon in background after setup', true)
    .option('--tcp-host <host>', 'TCP bind address', '127.0.0.1')
    .option('--tcp-port <port>', 'TCP port', '19876')
    .action(async (options: { detach: boolean; tcpHost: string; tcpPort: string }) => {
      const { existsSync } = await import('node:fs');
      const { DEFAULT_KEYSTORE_PATH } = await import('../../wallet/keystore.js');

      if (!existsSync(DEFAULT_KEYSTORE_PATH)) {
        process.stderr.write(
          '\n  Wallet not configured.\n' +
            '  Run "fence setup" first, then "fence quickstart" again.\n\n',
        );
        process.exitCode = 1;
        return;
      }
      process.stderr.write('\n  ✓ Wallet configured\n\n');

      const { promptPassword } = await import('../password-prompt.js');
      const { securePasswordFromPrompt } = await import('../../security/branded-types.js');
      const password = securePasswordFromPrompt(
        await promptPassword('  Enter keystore password: '),
      );

      if (options.detach) {
        const { forkDaemonDetached } = await import('../daemon-fork.js');
        const pid = forkDaemonDetached({ password, ...options });
        process.stderr.write(`\n  ✓ Daemon started in background (PID ${String(pid)})\n`);
        process.stderr.write('\n  Ready! Try:\n');
        process.stderr.write('    fence swap SUI USDC 100 --output json\n');
        process.stderr.write('    fence status\n');
        process.stderr.write('    fence tui\n\n');
      } else {
        const { startDaemon } = await import('../../daemon/index.js');
        await startDaemon({
          password,
          tcpHost: options.tcpHost,
          tcpPort: parseInt(options.tcpPort, 10),
        });
      }
    });
}
