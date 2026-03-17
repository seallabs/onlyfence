import type { Command } from 'commander';
import type Database from 'better-sqlite3';
import { registerWalletAddress } from '../../wallet/manager.js';

const SUI_ADDRESS_REGEX = /^0x[0-9a-fA-F]{64}$/;

/**
 * Register the `fence wallet watch` subcommand.
 *
 * Adds a watch-only wallet address for simulation without signing.
 *
 * @param walletCmd - The parent `wallet` command
 * @param getDb - Lazy database accessor
 */
export function registerWalletWatchCommand(
  walletCmd: Command,
  getDb: () => Database.Database,
): void {
  walletCmd
    .command('watch <address>')
    .description('Add a watch-only wallet (simulate trades without signing)')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .action((address: string, options: { chain: string }) => {
      if (options.chain === 'sui' && !SUI_ADDRESS_REGEX.test(address)) {
        throw new Error(
          `Invalid Sui address "${address}". Expected 0x followed by 64 hex characters.`,
        );
      }
      const db = getDb();
      registerWalletAddress(db, options.chain, address, false, true);
      console.log(`Watch-only wallet added: ${address} (${options.chain})`);
    });
}
