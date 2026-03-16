import type { Command } from 'commander';
import type { AppComponents } from '../bootstrap.js';
import { toErrorMessage } from '../../utils/index.js';

/**
 * Register the `fence stats` command.
 *
 * Shows CLI usage statistics from the local cli_events table.
 */
export function registerStatsCommand(program: Command, getComponents: () => AppComponents): void {
  program
    .command('stats')
    .description('Show CLI usage statistics')
    .option('-d, --days <days>', 'Show stats for last N days', '30')
    .option('-o, --output <format>', 'Output format (json|table)', 'table')
    .action((options: { days: string; output: string }) => {
      let components: AppComponents;
      try {
        components = getComponents();
      } catch (err: unknown) {
        console.error(`Error: ${toErrorMessage(err)}`);
        process.exitCode = 1;
        return;
      }

      const { cliEventLog } = components;
      const days = parseInt(options.days, 10);

      if (Number.isNaN(days) || days <= 0) {
        console.error('Error: --days must be a positive integer');
        process.exitCode = 1;
        return;
      }

      try {
        const stats = cliEventLog.getStats(days);

        if (options.output === 'json') {
          console.log(JSON.stringify(stats, null, 2));
          return;
        }

        // Table format
        const successRate =
          stats.totalCommands > 0
            ? ((stats.successCount / stats.totalCommands) * 100).toFixed(1)
            : '0.0';

        console.log(`OnlyFence Usage Statistics (last ${days} days)`);
        console.log('─'.repeat(50));
        console.log(`Total commands: ${stats.totalCommands}`);
        console.log(`Success rate:   ${successRate}%`);
        console.log(`Avg duration:   ${stats.avgDurationMs}ms`);

        if (stats.commandBreakdown.length > 0) {
          console.log('');
          console.log('Command              Count    Success Rate    Avg Duration');
          console.log('───────              ─────    ────────────    ────────────');
          for (const cmd of stats.commandBreakdown) {
            const rate = (cmd.successRate * 100).toFixed(1);
            console.log(
              `${cmd.command.padEnd(21)}${String(cmd.count).padEnd(9)}${(rate + '%').padEnd(16)}${cmd.avgDurationMs}ms`,
            );
          }
        }
      } catch (err: unknown) {
        console.error(`Error: ${toErrorMessage(err)}`);
        process.exitCode = 1;
      }
    });
}
