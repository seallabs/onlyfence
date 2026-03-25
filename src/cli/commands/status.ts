import type { Command } from 'commander';
import { toErrorMessage } from '../../utils/index.js';

/**
 * Register the `fence status` command.
 *
 * Reports health/status. Works in all tiers:
 * - Daemon running: queries daemon for status
 * - No daemon: shows standalone info
 */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show daemon and security status')
    .option('-o, --output <format>', 'Output format (json)', 'json')
    .action(async () => {
      const { detectExecutionMode, DaemonClient } = await import('../../daemon/index.js');

      const mode = detectExecutionMode();

      if (mode.mode === 'daemon-client') {
        // Query daemon for status
        try {
          const client = new DaemonClient(mode.address);
          const response = await client.send('status');

          if (response.ok) {
            console.log(JSON.stringify(response.data, null, 2));
            return;
          }

          console.error(`Daemon error: ${response.error ?? 'Unknown error'}`);
          process.exitCode = 1;
        } catch (err: unknown) {
          console.error(`Failed to query daemon: ${toErrorMessage(err)}`);
          process.exitCode = 1;
        }
      } else {
        // Standalone mode
        const { runStartupChecks } = await import('../../security/index.js');

        const warnings = runStartupChecks();
        const status = {
          tier: 'standalone',
          daemon: false,
          warnings: warnings.map((w) => ({
            level: w.level,
            code: w.code,
            message: w.message,
            fix: w.fix,
          })),
        };

        console.log(JSON.stringify(status, null, 2));
      }
    });
}
