import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { openDatabase, DB_PATH } from '../../db/connection.js';
import { initConfig, updateConfigFile, loadConfig, CONFIG_PATH } from '../../config/loader.js';
import { ConfigAlreadyExistsError } from '../../config/schema.js';
import {
  ensureSetupEnvironment,
  generateSetupWallet,
  importSetupWallet,
  saveSetupKeystore,
} from '../../wallet/setup.js';
import type { SetupResult } from '../../wallet/setup.js';
import { MIN_PASSWORD_LENGTH } from '../../wallet/keystore.js';
import { CURRENT_VERSION } from '../../update/version.js';
import { toErrorMessage } from '../../utils/errors.js';
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

/** Terminal control character constants. */
const KEY = {
  CTRL_C: '\x03',
  BACKSPACE_DEL: '\x7f',
  BACKSPACE_BS: '\b',
  ENTER_CR: '\r',
  ENTER_LF: '\n',
  ESCAPE: '\x1b',
} as const;

interface SetupOptions {
  readonly alias?: string;
  readonly mnemonicFile?: string;
  readonly passwordFile?: string;
  readonly generate?: boolean;
}

/**
 * Register the `fence setup` command on the given program.
 *
 * Two modes:
 *
 * **Interactive** (default when TTY):
 *   fence setup
 *   5-step wizard with prompts for wallet generation/import and password.
 *
 * **Non-interactive** (triggered by --password-file):
 *   fence setup --password-file /run/secrets/pw --mnemonic-file /run/secrets/mn
 *   fence setup --password-file /run/secrets/pw --generate
 *   echo "word1 word2 ..." | fence setup --password-file /run/secrets/pw
 *
 *   Outputs JSON to stdout for scripting:
 *     {"address":"0x...","chain":"sui:mainnet"}
 *     {"address":"0x...","chain":"sui:mainnet","mnemonic":"word1 word2 ..."}  (--generate only)
 */
export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Wallet setup — interactive wizard or non-interactive with file-based secrets')
    .option('-a, --alias <alias>', 'Custom alias for the wallet')
    .option('--mnemonic-file <path>', 'Import mnemonic from file (non-interactive)')
    .option('--password-file <path>', 'Read password from file (enables non-interactive mode)')
    .option('--generate', 'Generate a new wallet (non-interactive, outputs mnemonic in JSON)')
    .action(async (options: SetupOptions) => {
      const { passwordFile } = options;

      if (passwordFile === undefined) {
        // Interactive mode — flags that only make sense in non-interactive are rejected
        if (options.mnemonicFile !== undefined || options.generate === true) {
          error('--mnemonic-file and --generate require --password-file.');
          process.exitCode = 1;
          return;
        }
        await runInteractiveSetup(options.alias);
      } else {
        await runNonInteractiveSetup({ ...options, passwordFile });
      }
    });
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Read a secret file, throwing a human-friendly error on failure. */
function readSecretFile(filePath: string, label: string): string {
  try {
    return readFileSync(filePath, 'utf-8').trim();
  } catch (err: unknown) {
    const isNotFound = err instanceof Error && 'code' in err && err.code === 'ENOENT';
    throw new Error(
      isNotFound
        ? `${label} not found: ${filePath}`
        : `Cannot read ${label}: ${toErrorMessage(err)}`,
    );
  }
}

/** Read all of stdin with proper cleanup to avoid dangling listeners. */
function readStdinAll(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;

    const settle = (value: string): void => {
      if (settled) return;
      settled = true;
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      clearTimeout(timer);
      resolve(value);
    };

    const onData = (chunk: string): void => {
      data += chunk;
    };
    const onEnd = (): void => {
      settle(data);
    };

    stdin.setEncoding('utf-8');
    stdin.on('data', onData);
    stdin.on('end', onEnd);

    const timer = setTimeout(() => {
      settle(data);
      stdin.destroy();
    }, 5000);

    stdin.resume();
  });
}

// ── Non-interactive setup ────────────────────────────────────────────────────

/**
 * Non-interactive setup for Docker, K8s, and scripted environments.
 *
 * Reads password and mnemonic from files (or stdin for mnemonic).
 * Outputs wallet info as JSON to stdout — no prompts, no TUI.
 */
async function runNonInteractiveSetup(
  options: SetupOptions & { passwordFile: string },
): Promise<void> {
  const password = readSecretFile(options.passwordFile, 'password file');

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters (got ${String(password.length)}).`,
    );
  }

  const db = ensureSetupEnvironment();
  try {
    // Disable telemetry by default in non-interactive mode
    updateConfigFile((raw) => {
      if (raw['telemetry'] === undefined) {
        raw['telemetry'] = { enabled: false };
      }
    });

    let result: SetupResult;

    if (options.generate === true) {
      if (options.mnemonicFile !== undefined) {
        throw new Error('Cannot use both --generate and --mnemonic-file.');
      }
      result = generateSetupWallet(db, options.alias);
    } else {
      const mnemonic = await resolveMnemonic(options.mnemonicFile);
      result = importSetupWallet(db, mnemonic, options.alias);
    }

    saveSetupKeystore(result, password);

    // JSON to stdout for scripting
    const output: Record<string, string> = {
      address: result.address,
      chain: result.chainId,
    };
    if (options.generate === true) {
      output['mnemonic'] = result.mnemonic;
    }
    if (result.derivationPath !== null) {
      output['derivationPath'] = result.derivationPath;
    }
    process.stdout.write(JSON.stringify(output) + '\n');
  } finally {
    db.close();
  }
}

/**
 * Read mnemonic from file, stdin pipe, or throw with a helpful message.
 */
async function resolveMnemonic(mnemonicFile: string | undefined): Promise<string> {
  if (mnemonicFile !== undefined) {
    return readSecretFile(mnemonicFile, 'mnemonic file');
  }

  if (!stdin.isTTY) {
    const data = await readStdinAll();
    const trimmed = data.trim();
    if (trimmed.length > 0) return trimmed;
  }

  throw new Error('Mnemonic required. Provide via --mnemonic-file, stdin pipe, or use --generate.');
}

// ── Interactive setup ────────────────────────────────────────────────────────

const INTERACTIVE_STEPS = 5;

/** Interactive setup wizard with TTY prompts. */
async function runInteractiveSetup(alias?: string): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  let db: ReturnType<typeof openDatabase> | undefined;

  try {
    printLogo(CURRENT_VERSION);

    // Step 1: Init DB
    step(1, INTERACTIVE_STEPS, 'Initialize Database');
    db = openDatabase(DB_PATH);
    success(`Database ready at ${dim(DB_PATH)}`);

    // Step 2: Init default config if not exists
    step(2, INTERACTIVE_STEPS, 'Configure');
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
    step(3, INTERACTIVE_STEPS, 'Wallet Setup');

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
      result = importSetupWallet(db, mnemonic, alias);

      success('Wallet imported successfully!');
      console.log('');
      box([`${bold('Chain')}    ${result.chainId}`, `${bold('Address')}  ${result.address}`]);
    } else {
      result = generateSetupWallet(db, alias);

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
    step(4, INTERACTIVE_STEPS, 'Encrypt Keystore');

    const password = await promptPasswordWithConfirm();

    saveSetupKeystore(result, password);
    success('Keystore saved and encrypted.');

    // Step 5: Telemetry opt-in (only if not already configured)
    const config = loadConfig(CONFIG_PATH);
    if (config.telemetry === undefined) {
      step(5, INTERACTIVE_STEPS, 'Anonymous Error Reporting');
      console.log('');
      console.log(`  OnlyFence can report anonymous crash data to help improve the tool.`);
      console.log(`  ${dim('No wallet addresses, keys, balances, or trade data will be sent.')}`);
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
}

// ── Interactive prompt helpers ───────────────────────────────────────────────

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
 * Prompt for password + confirmation with retry on mismatch.
 * Loops until both entries match and meet minimum length.
 */
async function promptPasswordWithConfirm(): Promise<string> {
  for (;;) {
    const password = await promptPasswordWithRetry(
      `  ${cyan('?')} Enter a password to encrypt your keystore: `,
    );
    const confirm = await promptPasswordWithRetry(`  ${cyan('?')} Confirm password: `);

    if (password === confirm) {
      return password;
    }
    warn('Passwords do not match. Please try again.');
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
