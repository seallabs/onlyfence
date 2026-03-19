import type { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { openDatabase, DB_PATH } from '../../db/connection.js';
import { initConfig, updateConfigFile, loadConfig, CONFIG_PATH } from '../../config/loader.js';
import { ConfigAlreadyExistsError } from '../../config/schema.js';
import { generateSetupWallet, importSetupWallet, saveSetupKeystore } from '../../wallet/setup.js';
import type { SetupResult } from '../../wallet/setup.js';
import { MIN_PASSWORD_LENGTH } from '../../wallet/keystore.js';
import { CURRENT_VERSION } from '../../update/version.js';
import {
  printLogo,
  step,
  info,
  success,
  warn,
  error,
  box,
  bold,
  cyan,
  dim,
  yellow,
  green,
} from '../style.js';

const TOTAL_STEPS = 5;

/** Terminal control character constants. */
const KEY = {
  CTRL_C: '\x03',
  BACKSPACE_DEL: '\x7f',
  BACKSPACE_BS: '\b',
  ENTER_CR: '\r',
  ENTER_LF: '\n',
  ESCAPE: '\x1b',
} as const;

/**
 * Execute a callback with stdin in raw mode, restoring the previous
 * raw-mode state afterwards — even on error.
 */
async function withRawMode<T>(fn: () => Promise<T>): Promise<T> {
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  try {
    return await fn();
  } finally {
    stdin.setRawMode(wasRaw);
  }
}

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
        printLogo(CURRENT_VERSION);

        // Step 1: Init DB
        step(1, TOTAL_STEPS, 'Initialize Database');
        db = openDatabase(DB_PATH);
        success(`Database ready at ${dim(DB_PATH)}`);

        // Step 2: Init default config if not exists
        step(2, TOTAL_STEPS, 'Configure');
        try {
          initConfig(CONFIG_PATH, false);
          success(`Default config created at ${dim(CONFIG_PATH)}`);
        } catch (err: unknown) {
          if (err instanceof ConfigAlreadyExistsError) {
            info(`Config already exists at ${dim(CONFIG_PATH)}`);
          } else {
            throw err;
          }
        }

        // Step 3: Wallet setup
        step(3, TOTAL_STEPS, 'Wallet Setup');

        const choice = await rl.question(
          `  ${cyan('?')} Would you like to ${bold('(g)enerate')} a new wallet or ${bold('(i)mport')} an existing one? ${dim('[g/i]')}: `,
        );

        let result: SetupResult;

        const trimmed = choice.trim();
        // Detect if the user pasted a mnemonic phrase directly at the g/i prompt
        const looksLikeMnemonic = trimmed.split(/\s+/).length >= 12;

        if (trimmed.toLowerCase() === 'i' || looksLikeMnemonic) {
          const mnemonic = looksLikeMnemonic
            ? trimmed
            : await rl.question(`  ${cyan('?')} Enter your BIP-39 mnemonic phrase: `);
          result = importSetupWallet(db, mnemonic, options.alias);

          success('Wallet imported successfully!');
          console.log('');
          box([`${bold('Chain')}    ${result.chainId}`, `${bold('Address')}  ${result.address}`]);
        } else {
          result = generateSetupWallet(db, options.alias);

          success('New wallet generated!');
          console.log('');

          // Mnemonic warning box
          box(
            [
              bold(yellow('⚠  BACK UP YOUR MNEMONIC PHRASE')),
              '',
              green(result.mnemonic),
              '',
              dim('Write it down and store it somewhere safe.'),
              dim('You will NOT see this again.'),
            ],
            yellow,
          );

          console.log('');
          box([
            `${bold('Chain')}    ${result.chainId}`,
            `${bold('Address')}  ${result.address}`,
            `${bold('Path')}     ${result.derivationPath ?? 'N/A'}`,
          ]);
        }

        // Detach readline before password prompts — its keypress listeners
        // echo characters even in raw mode. Pause + remove listeners to stop
        // echo, then resume stdin for raw-mode password input.
        rl.pause();
        stdin.removeAllListeners('keypress');
        stdin.resume();

        // Step 4: Encrypt and save keystore
        step(4, TOTAL_STEPS, 'Encrypt Keystore');

        const password = await promptPasswordWithRetry(
          `  ${cyan('?')} Enter a password to encrypt your keystore: `,
        );
        const confirmPassword = await promptPasswordWithRetry(`  ${cyan('?')} Confirm password: `);

        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }

        saveSetupKeystore(result, password);
        success('Keystore saved and encrypted.');

        // Step 5: Telemetry opt-in (only if not already configured)
        const config = loadConfig(CONFIG_PATH);
        if (config.telemetry === undefined) {
          step(5, TOTAL_STEPS, 'Anonymous Error Reporting');
          console.log('');
          console.log(`  OnlyFence can report anonymous crash data to help improve the tool.`);
          console.log(
            `  ${dim('No wallet addresses, keys, balances, or trade data will be sent.')}`,
          );
          console.log('');

          const telemetryChoice = await promptYesNo(
            `  ${cyan('?')} Enable anonymous error reporting? ${dim('[y/N]')}: `,
          );
          const enabled = telemetryChoice === 'y';

          updateConfigFile((raw) => {
            raw['telemetry'] = { enabled };
          });

          if (enabled) {
            success('Error reporting enabled. Thank you!');
          } else {
            info('Error reporting disabled.');
          }
          info(`You can change this later in ${dim('config.toml [telemetry]')}`);
        }

        // Completion banner
        console.log('');
        box(
          [
            bold(green('Setup complete!')),
            '',
            `Run ${cyan('fence swap')} to execute trades.`,
            `Run ${cyan('fence --help')} for all commands.`,
          ],
          green,
        );
        console.log('');
      } catch (err: unknown) {
        error(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        db?.close();
        rl.close();
        stdin.pause();
      }
    });
}

/**
 * Prompt for a single-key y/n input using raw stdin.
 * Returns the lowercase key pressed ('y' or 'n').
 * Any key other than y/Y defaults to 'n'.
 */
async function promptYesNo(prompt: string): Promise<'y' | 'n'> {
  return withRawMode(() => {
    stdout.write(prompt);

    return new Promise<'y' | 'n'>((resolve) => {
      const onData = (key: Buffer): void => {
        const ch = key.toString('utf8');

        if (ch === KEY.CTRL_C) {
          stdin.removeListener('data', onData);
          stdout.write('\n');
          process.exit(130);
        }

        stdin.removeListener('data', onData);

        if (ch.toLowerCase() === 'y') {
          stdout.write('y\n');
          resolve('y');
        } else {
          stdout.write('n\n');
          resolve('n');
        }
      };

      stdin.on('data', onData);
    });
  });
}

/**
 * Prompt for a password with retry on validation failure.
 * Loops until the user provides a valid password.
 */
async function promptPasswordWithRetry(prompt: string): Promise<string> {
  for (;;) {
    const password = await promptPassword(prompt);
    if (password.length >= MIN_PASSWORD_LENGTH) {
      return password;
    }
    warn(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  }
}

/**
 * Prompt for a password input with echo disabled so the password
 * is not visible in the terminal.
 *
 * Raw mode is enabled BEFORE writing the prompt to prevent
 * the terminal from echoing the first keystroke in plain text.
 */
async function promptPassword(prompt: string): Promise<string> {
  return withRawMode(() => {
    stdout.write(prompt);

    return new Promise<string>((resolve) => {
      let buf = '';
      const onData = (key: Buffer): void => {
        const ch = key.toString('utf8');

        if (ch === KEY.ENTER_CR || ch === KEY.ENTER_LF) {
          stdin.removeListener('data', onData);
          stdout.write('\n');
          resolve(buf);
        } else if (ch === KEY.BACKSPACE_DEL || ch === KEY.BACKSPACE_BS) {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            stdout.write('\b \b');
          }
        } else if (ch === KEY.CTRL_C) {
          stdin.removeListener('data', onData);
          stdout.write('\n');
          process.exit(130);
        } else if (!ch.startsWith(KEY.ESCAPE)) {
          buf += ch;
          stdout.write('•');
        }
      };

      stdin.on('data', onData);
    });
  });
}
