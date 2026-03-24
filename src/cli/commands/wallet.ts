import type Database from 'better-sqlite3';
import type { Command } from 'commander';
import { toErrorMessage } from '../../utils/index.js';
import { listWallets } from '../../wallet/manager.js';
import type { AppComponents } from '../bootstrap.js';
import { withComponents } from '../with-components.js';
import { registerWalletImportKeyCommand } from './wallet-import-key.js';
import { registerWalletRenameCommand } from './wallet-rename.js';
import { registerWalletSwitchCommand } from './wallet-switch.js';
import { registerWalletWatchCommand } from './wallet-watch.js';

/**
 * Register the `fence wallet` command group.
 *
 * Subcommands:
 * - `fence wallet list` - List all wallets
 * - `fence wallet watch <address>` - Add a watch-only wallet
 * - `fence wallet switch <alias>` - Set a wallet as primary for its chain
 * - `fence wallet rename <old> <new>` - Rename a wallet alias
 */
export function registerWalletCommand(program: Command, getComponents: () => AppComponents): void {
  const walletCmd = program.command('wallet').description('Manage wallets');

  const getDb = (): Database.Database => getComponents().db;

  // Register subcommands with lazy DB accessor
  registerWalletWatchCommand(walletCmd, getDb);
  registerWalletSwitchCommand(walletCmd, getDb);
  registerWalletRenameCommand(walletCmd, getDb);
  registerWalletImportKeyCommand(walletCmd, getDb);

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
          console.log('Alias        Chain     Primary  Watch-Only  Address');
          console.log('───────────  ─────     ───────  ──────────  ───────');
          for (const w of wallets) {
            const primaryStr = w.isPrimary ? '*' : '';
            const watchStr = w.isWatchOnly ? '*' : '';
            console.log(
              `${w.alias.padEnd(13)}${w.chainId.padEnd(10)}${primaryStr.padEnd(9)}${watchStr.padEnd(12)}${w.address}`,
            );
          }
        }
      } catch (err: unknown) {
        console.error(`Error: ${toErrorMessage(err)}`);
        process.exitCode = 1;
      }
    });
}
