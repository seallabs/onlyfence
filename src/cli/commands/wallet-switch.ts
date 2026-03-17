import type { Command } from 'commander';
import type Database from 'better-sqlite3';
import { switchWallet } from '../../wallet/manager.js';

/**
 * Register the `fence wallet switch` subcommand.
 *
 * Sets the specified wallet as the primary wallet for its chain.
 *
 * @param walletCmd - The parent `wallet` command
 * @param getDb - Lazy database accessor
 */
export function registerWalletSwitchCommand(
  walletCmd: Command,
  getDb: () => Database.Database,
): void {
  walletCmd
    .command('switch <alias>')
    .description('Set a wallet as primary for its chain')
    .action((alias: string) => {
      const db = getDb();
      switchWallet(db, alias);
      console.log(`Switched to wallet "${alias}"`);
    });
}
