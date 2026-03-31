import type Database from 'better-sqlite3';
import type { Command } from 'commander';
import { registerWalletAddress } from '../../wallet/manager.js';
import type { AppConfig } from '../../types/config.js';
import { resolveDefaultChain } from '../resolve-chain.js';

const SUI_ADDRESS_REGEX = /^0x[0-9a-fA-F]{64}$/;

/**
 * Register the `fence wallet watch` subcommand.
 *
 * Adds a watch-only wallet address for simulation without signing.
 *
 * @param walletCmd - The parent `wallet` command
 * @param getDb - Lazy database accessor
 * @param getConfig - Lazy config accessor for default chain resolution
 */
export function registerWalletWatchCommand(
  walletCmd: Command,
  getDb: () => Database.Database,
  getConfig: () => AppConfig,
): void {
  walletCmd
    .command('watch <address>')
    .description('Add a watch-only wallet (simulate trades without signing)')
    .option('-c, --chain <chain>', 'Target chain')
    .option('-a, --alias <alias>', 'Custom alias for the wallet')
    .action((address: string, options: { chain?: string; alias?: string }) => {
      const chain = options.chain ?? resolveDefaultChain(getConfig());
      if (chain === 'sui' && !SUI_ADDRESS_REGEX.test(address)) {
        throw new Error(
          `Invalid Sui address "${address}". Expected 0x followed by 64 hex characters.`,
        );
      }
      const db = getDb();
      const config = getConfig();
      const network = config.chain[chain]?.network ?? 'mainnet';
      const chainId = `${chain}:${network}`;
      const result = registerWalletAddress(db, chainId, address, false, true, options.alias);
      console.log(
        `Watch-only wallet added: ${address} (${chainId}) [alias: ${result.wallet.alias}]`,
      );
    });
}
