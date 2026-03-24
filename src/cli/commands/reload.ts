import type { Command } from 'commander';
import { toErrorMessage } from '../../utils/index.js';

/**
 * Register the `fence reload` command.
 *
 * Sends a password-authenticated config reload request to the daemon.
 */
export function registerReloadCommand(program: Command): void {
  program
    .command('reload')
    .description('Reload config in the running daemon (requires password)')
    .action(async () => {
      const { isDaemonRunning, DaemonClient, detectExecutionMode } =
        await import('../../daemon/index.js');

      if (!isDaemonRunning()) {
        console.error(
          'No daemon is running. Config reload only applies in daemon mode.\n' +
            '  In standalone mode, config changes take effect on next command.',
        );
        process.exitCode = 1;
        return;
      }

      const { promptPassword } = await import('../password-prompt.js');
      const password = await promptPassword('Enter keystore password: ');

      const mode = detectExecutionMode();
      const addr = mode.mode === 'daemon-client' ? mode.address : '';
      const client = new DaemonClient(addr);

      try {
        const response = await client.send('reload', { password });

        if (response.ok) {
          const data = response.data as { configHash?: string } | undefined;
          console.error(`Config reloaded successfully.`);
          if (data?.configHash !== undefined) {
            console.error(`  New config hash: ${data.configHash}`);
          }
        } else {
          console.error(`Reload failed: ${response.error ?? 'Unknown error'}`);
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        console.error(`Failed to reload: ${toErrorMessage(err)}`);
        process.exitCode = 1;
      }
    });
}
