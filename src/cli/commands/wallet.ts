import type { Command } from 'commander';
import type { AppComponents } from '../bootstrap.js';
import { listWallets } from '../../wallet/manager.js';
import { toErrorMessage } from '../../utils/index.js';
import { withComponents } from '../with-components.js';

/**
 * Register the `fence wallet` command group.
 *
 * Subcommands:
 * - `fence wallet list` - List all wallets
 */
export function registerWalletCommand(program: Command, getComponents: () => AppComponents): void {
  const walletCmd = program.command('wallet').description('Manage wallets');

  // fence wallet list
  walletCmd
    .command('list')
    .description('List all wallets')
    .option('-o, --output <format>', 'Output format (json|table)', 'table')
    .action((options: { output: string }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const { db } = components;

      try {
        const wallets = listWallets(db);

        if (wallets.length === 0) {
          console.log('No wallets found. Run "fence setup" to create one.');
          return;
        }

        if (options.output === 'json') {
          console.log(JSON.stringify(wallets, null, 2));
        } else {
          console.log('Chain     Primary  Address');
          console.log('─────     ───────  ───────');
          for (const w of wallets) {
            const primaryStr = w.isPrimary ? 'Yes' : 'No';
            console.log(`${w.chain.padEnd(10)}${primaryStr.padEnd(9)}${w.address}`);
          }
        }
      } catch (err: unknown) {
        console.error(`Error: ${toErrorMessage(err)}`);
        process.exitCode = 1;
      }
    });
}
