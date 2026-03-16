import type { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { openDatabase, DB_PATH } from '../../db/connection.js';
import { initConfig, CONFIG_PATH } from '../../config/loader.js';
import { ConfigAlreadyExistsError } from '../../config/schema.js';
import { generateWallet, importFromMnemonic, saveKeystore } from '../../wallet/index.js';
import type { KeystoreData } from '../../wallet/types.js';
import type { GenerateWalletResult, ImportWalletResult } from '../../wallet/manager.js';

/**
 * Register the `fence setup` command on the given program.
 *
 * Interactive wallet setup wizard:
 * - Ask: generate new or import existing
 * - If generate: call wallet manager generateWallet(), show mnemonic + addresses
 * - If import: ask for mnemonic, call importFromMnemonic()
 * - Ask for password to encrypt keystore
 * - Save encrypted keystore
 * - Init default config if not exists
 * - Init SQLite DB
 */
export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Interactive wallet setup wizard')
    .action(async () => {
      const rl = createInterface({ input: stdin, output: stdout });

      try {
        // Step 1: Init DB
        console.log('Initializing database...');
        const db = openDatabase(DB_PATH);

        // Step 2: Init default config if not exists
        try {
          initConfig(CONFIG_PATH, false);
          console.log(`Default config created at ${CONFIG_PATH}`);
        } catch (err: unknown) {
          if (err instanceof ConfigAlreadyExistsError) {
            console.log(`Config already exists at ${CONFIG_PATH}`);
          } else {
            throw err;
          }
        }

        // Step 3: Ask generate or import
        const choice = await rl.question(
          'Would you like to (g)enerate a new wallet or (i)mport an existing one? [g/i]: ',
        );

        let privateKeyHex: string;

        if (choice.toLowerCase() === 'i') {
          // Import existing mnemonic
          const mnemonic = await rl.question('Enter your BIP-39 mnemonic phrase: ');
          const result: ImportWalletResult = importFromMnemonic(db, mnemonic.trim());

          console.log('\nWallet imported successfully!');
          console.log(`  Chain:   ${result.wallet.chain}`);
          console.log(`  Address: ${result.wallet.address}`);

          privateKeyHex = result.privateKeyHex;

          // Build keystore data
          const keystoreData: KeystoreData = {
            mnemonic: mnemonic.trim(),
            keys: { sui: privateKeyHex },
          };

          // Step 4: Encrypt and save keystore
          const password = await promptPassword(rl, 'Enter a password to encrypt your keystore: ');
          const confirmPassword = await promptPassword(rl, 'Confirm password: ');

          if (password !== confirmPassword) {
            throw new Error('Passwords do not match.');
          }

          saveKeystore(keystoreData, password);
          console.log('\nKeystore saved and encrypted.');
        } else {
          // Generate new wallet
          const result: GenerateWalletResult = generateWallet(db);

          console.log('\n--- IMPORTANT: Back up your mnemonic phrase! ---');
          console.log(`Mnemonic: ${result.mnemonic}`);
          console.log('--- Keep this safe. You will NOT see it again. ---\n');

          for (const wallet of result.wallets) {
            console.log(`  Chain:   ${wallet.chain}`);
            console.log(`  Address: ${wallet.address}`);
            console.log(`  Path:    ${wallet.derivationPath ?? 'N/A'}`);
          }

          privateKeyHex = result.privateKeyHex;

          // Build keystore data
          const keystoreData: KeystoreData = {
            mnemonic: result.mnemonic,
            keys: { sui: privateKeyHex },
          };

          // Step 4: Encrypt and save keystore
          const password = await promptPassword(
            rl,
            '\nEnter a password to encrypt your keystore: ',
          );
          const confirmPassword = await promptPassword(rl, 'Confirm password: ');

          if (password !== confirmPassword) {
            throw new Error('Passwords do not match.');
          }

          saveKeystore(keystoreData, password);
          console.log('\nKeystore saved and encrypted.');
        }

        console.log('\nSetup complete! You can now use `fence swap` to execute trades.');
        db.close();
      } finally {
        rl.close();
      }
    });
}

/**
 * Prompt for a password input. Note: in a real terminal app you would
 * disable echo; readline/promises does not support that natively,
 * so we use a standard prompt.
 */
async function promptPassword(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
): Promise<string> {
  const password = await rl.question(prompt);
  if (password.length === 0) {
    throw new Error('Password must not be empty.');
  }
  return password;
}
