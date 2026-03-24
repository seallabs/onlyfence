import type Database from 'better-sqlite3';
import type { Command } from 'commander';
import { importFromPrivateKey } from '../../wallet/manager.js';
import { mergeKeyIntoKeystore } from '../../wallet/setup.js';
import { toErrorMessage } from '../../utils/index.js';

/**
 * Prompt for hidden input from the terminal with echo disabled.
 *
 * Uses raw mode to prevent the input from appearing on screen.
 * Output goes to stderr so it doesn't pollute JSON stdout.
 */
function promptSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof process.stdin.setRawMode !== 'function') {
      reject(new Error('Cannot securely read input: terminal does not support raw mode.'));
      return;
    }

    process.stderr.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let buf = '';

    const cleanup = (): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stderr.write('\n');
    };

    const onData = (ch: string): void => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        cleanup();
        resolve(buf);
      } else if (ch === '\u0003') {
        cleanup();
        reject(new Error('Input cancelled.'));
      } else if (ch === '\u007F' || ch === '\b') {
        buf = buf.slice(0, -1);
      } else {
        buf += ch;
      }
    };

    process.stdin.on('data', onData);
  });
}

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

        const password = await promptSecret('Enter keystore password: ');
        if (password.length === 0) {
          throw new Error('Password cannot be empty.');
        }

        const db = getDb();
        const result = importFromPrivateKey(db, privateKeyInput, options.alias);

        mergeKeyIntoKeystore(result.wallet.chainId, result.privateKeyHex, password);

        console.log(
          `Wallet imported: ${result.wallet.address} (${result.wallet.chainId}) [alias: ${result.wallet.alias}]`,
        );
      } catch (err: unknown) {
        console.error(`Error: ${toErrorMessage(err)}`);
        process.exitCode = 1;
      }
    });
}
