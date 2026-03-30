import type { Command } from 'commander';
import { registerWalletAddress } from '../../wallet/manager.js';
import type { AppComponents } from '../bootstrap.js';

const SUI_ADDRESS_REGEX = /^0x[0-9a-fA-F]{64}$/;

/**
 * Register the `fence wallet watch` subcommand.
 *
 * Adds a watch-only wallet address for simulation without signing.
 *
 * @param walletCmd - The parent `wallet` command
 * @param getComponents - Lazy app components accessor
 */
export function registerWalletWatchCommand(
  walletCmd: Command,
  getComponents: () => AppComponents,
): void {
  walletCmd
    .command('watch <address>')
    .description('Add a watch-only wallet (simulate trades without signing)')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .option('-a, --alias <alias>', 'Custom alias for the wallet')
    .action((address: string, options: { chain: string; alias?: string }) => {
      if (options.chain === 'sui' && !SUI_ADDRESS_REGEX.test(address)) {
        throw new Error(
          `Invalid Sui address "${address}". Expected 0x followed by 64 hex characters.`,
        );
      }
      const components = getComponents();
      const chainId = components.chainRegistry.get(options.chain).defaultChainId;
      const result = registerWalletAddress(
        components.db,
        chainId,
        address,
        false,
        true,
        options.alias,
      );
      console.log(
        `Watch-only wallet added: ${address} (${chainId}) [alias: ${result.wallet.alias}]`,
      );
    });
}
