import type { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { openDatabase, DB_PATH } from '../../db/connection.js';
import { initConfig, CONFIG_PATH } from '../../config/loader.js';
import { ConfigAlreadyExistsError } from '../../config/schema.js';
import { generateSetupWallet, importSetupWallet, saveSetupKeystore } from '../../wallet/setup.js';
import type { SetupResult } from '../../wallet/setup.js';
import { MIN_PASSWORD_LENGTH } from '../../wallet/keystore.js';

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
    .option('-a, --alias <alias>', 'Custom alias for the wallet')
    .action(async (options: { alias?: string }) => {
      const rl = createInterface({ input: stdin, output: stdout });
      let db: ReturnType<typeof openDatabase> | undefined;

      try {
        // Step 1: Init DB
        console.log('Initializing database...');
        db = openDatabase(DB_PATH);

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

        let result: SetupResult;

        if (choice.toLowerCase() === 'i') {
          const mnemonic = await rl.question('Enter your BIP-39 mnemonic phrase: ');
          result = importSetupWallet(db, mnemonic, options.alias);

          console.log('\nWallet imported successfully!');
          console.log(`  Chain:   ${result.chainId}`);
          console.log(`  Address: ${result.address}`);
        } else {
          result = generateSetupWallet(db, options.alias);

          console.log('\n--- IMPORTANT: Back up your mnemonic phrase! ---');
          console.log(`Mnemonic: ${result.mnemonic}`);
          console.log('--- Keep this safe. You will NOT see it again. ---\n');

          console.log(`  Chain:   ${result.chainId}`);
          console.log(`  Address: ${result.address}`);
          console.log(`  Path:    ${result.derivationPath ?? 'N/A'}`);
        }

        // Step 4: Encrypt and save keystore
        const password = await promptPassword(rl, '\nEnter a password to encrypt your keystore: ');
        const confirmPassword = await promptPassword(rl, 'Confirm password: ');

        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }

        saveSetupKeystore(result, password);
        console.log('\nKeystore saved and encrypted.');

        console.log('\nSetup complete! You can now use `fence swap` to execute trades.');
      } finally {
        db?.close();
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
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  }
  return password;
}
