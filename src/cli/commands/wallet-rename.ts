import type { Command } from 'commander';
import type Database from 'better-sqlite3';
import { renameAlias } from '../../wallet/manager.js';

/**
 * Register the `fence wallet rename` subcommand.
 *
 * Renames an existing wallet alias.
 *
 * @param walletCmd - The parent `wallet` command
 * @param getDb - Lazy database accessor
 */
export function registerWalletRenameCommand(
  walletCmd: Command,
  getDb: () => Database.Database,
): void {
  walletCmd
    .command('rename <oldAlias> <newAlias>')
    .description('Rename a wallet alias')
    .action((oldAlias: string, newAlias: string) => {
      const db = getDb();
      renameAlias(db, oldAlias, newAlias);
      console.log(`Renamed wallet "${oldAlias}" to "${newAlias}"`);
    });
}
