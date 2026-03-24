import type Database from 'better-sqlite3';
import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { importFromPrivateKey, removeWallet } from '../../wallet/manager.js';
import { mergeKeyIntoKeystore, saveSetupKeystore } from '../../wallet/setup.js';
import { DEFAULT_KEYSTORE_PATH } from '../../wallet/keystore.js';
import { toErrorMessage } from '../../utils/index.js';
import { promptSecret, promptPasswordWithRetry } from '../prompt.js';

/**
 * Register the `fence wallet import-key` subcommand.
 *
 * Imports a wallet from a raw private key (hex or suiprivkey bech32).
 * The key and password are prompted interactively with hidden input.
 *
 * @param walletCmd - The parent `wallet` command
 * @param getDb - Lazy database accessor
 */
export function registerWalletImportKeyCommand(
  walletCmd: Command,
  getDb: () => Database.Database,
): void {
  walletCmd
    .command('import-key')
    .description('Import a wallet from a private key (hex or suiprivkey1… bech32)')
    .option('-a, --alias <alias>', 'Custom alias for the wallet')
    .action(async (options: { alias?: string }) => {
      try {
        if (!process.stdin.isTTY) {
          throw new Error(
            'fence wallet import-key requires an interactive terminal to securely enter your private key.',
          );
        }

        const privateKeyInput = await promptSecret('Enter private key (hex or suiprivkey1…): ');
        if (privateKeyInput.length === 0) {
          throw new Error('Private key cannot be empty.');
        }

        const keystoreExists = existsSync(DEFAULT_KEYSTORE_PATH);

        let password: string;

        if (keystoreExists) {
          password = await promptPasswordWithRetry('Enter keystore password: ');
        } else {
          password = await promptPasswordWithRetry('Enter a password to encrypt your keystore: ');
          const confirm = await promptPasswordWithRetry('Confirm password: ');
          if (password !== confirm) {
            throw new Error('Passwords do not match.');
          }
        }

        const db = getDb();
        const result = importFromPrivateKey(db, privateKeyInput, options.alias);

        // Attempt keystore save — rollback DB record on failure
        try {
          if (keystoreExists) {
            mergeKeyIntoKeystore(result.wallet.chainId, result.privateKeyHex, password);
          } else {
            saveSetupKeystore(
              {
                address: result.wallet.address,
                chainId: result.wallet.chainId,
                derivationPath: null,
                privateKeyHex: result.privateKeyHex,
              },
              password,
            );
          }
        } catch (keystoreErr: unknown) {
          // Rollback: remove the wallet record that was just inserted
          removeWallet(db, result.wallet.address);
          throw keystoreErr;
        }

        console.log(
          `Wallet imported: ${result.wallet.address} (${result.wallet.chainId}) [alias: ${result.wallet.alias}]`,
        );
      } catch (err: unknown) {
        console.error(`Error: ${toErrorMessage(err)}`);
        process.exitCode = 1;
      }
    });
}
