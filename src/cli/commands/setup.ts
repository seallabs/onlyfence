import type { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { buildChainRegistry } from '../../chain/registry.js';
import type { ChainDefinition } from '../../chain/registry.js';
import { openDatabase, DB_PATH } from '../../db/connection.js';
import { initConfig, updateConfigFile, loadConfig, CONFIG_PATH } from '../../config/loader.js';
import { ConfigAlreadyExistsError } from '../../config/schema.js';
import {
  ensureSetupEnvironment,
  generateSetupWallet,
  importSetupWallet,
  importSetupWalletFromKey,
  saveSetupKeystore,
  mergeKeyIntoKeystore,
} from '../../wallet/setup.js';
import type { SetupResult } from '../../wallet/setup.js';
import { DEFAULT_KEYSTORE_PATH, MIN_PASSWORD_LENGTH } from '../../wallet/keystore.js';
import { CURRENT_VERSION } from '../../update/version.js';
import { isEnoentError, toErrorMessage } from '../../utils/errors.js';
import {
  printLogo,
  step,
  info,
  success,
  error,
  box,
  bold,
  cyan,
  dim,
  yellow,
  green,
} from '../style.js';
import { promptSecret, promptPasswordWithRetry, promptYesNo } from '../prompt.js';

interface SetupOptions {
  readonly alias?: string;
  readonly mnemonicFile?: string;
  readonly passwordFile?: string;
  readonly generate?: boolean;
}

/** Get the default chain definitions for setup. */
function getSetupChains(): readonly ChainDefinition[] {
  const registry = buildChainRegistry();
  // Default to Sui for backwards compatibility.
  // TODO: Add chain selection step to interactive setup.
  return [registry.get('sui')];
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
    throw new Error(
      isEnoentError(err)
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

    const chains = getSetupChains();
    let result: SetupResult;

    if (options.generate === true) {
      if (options.mnemonicFile !== undefined) {
        throw new Error('Cannot use both --generate and --mnemonic-file.');
      }
      result = generateSetupWallet(db, chains, options.alias);
    } else {
      const mnemonic = await resolveMnemonic(options.mnemonicFile);
      result = importSetupWallet(db, mnemonic, chains, options.alias);
    }

    saveSetupKeystore(result, password);

    // JSON to stdout for scripting — output first wallet for backwards compat
    const firstWallet = result.wallets[0];
    const output: Record<string, string> = {
      address: firstWallet?.address ?? '',
      chain: firstWallet?.chainId ?? '',
    };
    if (options.generate === true) {
      output['mnemonic'] = result.mnemonic ?? '';
    }
    if (firstWallet?.derivationPath !== null && firstWallet?.derivationPath !== undefined) {
      output['derivationPath'] = firstWallet.derivationPath;
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

const INTERACTIVE_STEPS = 6;

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
      `  ${cyan('?')} Would you like to ${bold('(g)enerate')} a new wallet, ${bold('(i)mport')} by mnemonic, or import by private ${bold('(k)ey')}? ${dim('[g/i/k]')}: `,
    );

    const chains = getSetupChains();
    let result: SetupResult;

    const trimmed = choice.trim();
    // Detect if the user pasted a mnemonic phrase directly at the prompt
    const looksLikeMnemonic = trimmed.split(/\s+/).length >= 12;

    if (trimmed.toLowerCase() === 'k') {
      // Detach readline before secret prompt — its keypress listeners
      // echo characters even in raw mode.
      rl.pause();
      stdin.removeAllListeners('keypress');
      stdin.resume();

      const privateKey = await promptSecret(
        `  ${cyan('?')} Enter your private key (hex or suiprivkey1…): `,
      );
      // Private key import is single-chain (the key is chain-specific)
      const firstChain = chains[0];
      if (firstChain === undefined) throw new Error('No chains configured for setup.');
      result = importSetupWalletFromKey(db, privateKey, firstChain, alias);

      const w = result.wallets[0];
      success('Wallet imported from private key!');
      console.log('');
      box([`${bold('Chain')}    ${w?.chainId ?? ''}`, `${bold('Address')}  ${w?.address ?? ''}`]);
    } else if (trimmed.toLowerCase() === 'i' || looksLikeMnemonic) {
      const mnemonic = looksLikeMnemonic
        ? trimmed
        : await rl.question(`  ${cyan('?')} Enter your BIP-39 mnemonic phrase: `);
      result = importSetupWallet(db, mnemonic, chains, alias);

      const w = result.wallets[0];
      success('Wallet imported successfully!');
      console.log('');
      box([`${bold('Chain')}    ${w?.chainId ?? ''}`, `${bold('Address')}  ${w?.address ?? ''}`]);
    } else {
      result = generateSetupWallet(db, chains, alias);

      success('New wallet generated!');
      console.log('');

      // Mnemonic warning box
      box(
        [
          bold(yellow('⚠  BACK UP YOUR MNEMONIC PHRASE')),
          '',
          green(result.mnemonic ?? ''),
          '',
          dim('Write it down and store it somewhere safe.'),
          dim('You will NOT see this again.'),
        ],
        yellow,
      );

      const w = result.wallets[0];
      console.log('');
      box([
        `${bold('Chain')}    ${w?.chainId ?? ''}`,
        `${bold('Address')}  ${w?.address ?? ''}`,
        `${bold('Path')}     ${w?.derivationPath ?? 'N/A'}`,
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

    const keystoreExists = existsSync(DEFAULT_KEYSTORE_PATH);

    if (keystoreExists) {
      info('Existing keystore found. Enter your password to add the new key.');
      const password = await promptPasswordWithRetry(`  ${cyan('?')} Enter keystore password: `);
      // Merge all new chain keys into the existing keystore
      for (const [chainId, keyHex] of Object.entries(result.keys)) {
        mergeKeyIntoKeystore(chainId, keyHex, password);
      }
    } else {
      const password = await promptPasswordWithRetry(
        `  ${cyan('?')} Enter a password to encrypt your keystore: `,
      );
      const confirmPassword = await promptPasswordWithRetry(`  ${cyan('?')} Confirm password: `);

      if (password !== confirmPassword) {
        throw new Error('Passwords do not match.');
      }

      saveSetupKeystore(result, password);
    }

    success('Keystore saved and encrypted.');

    // Step 5: Automatic updates (only if not already configured)
    const config = loadConfig(CONFIG_PATH);
    if (config.update === undefined) {
      step(5, INTERACTIVE_STEPS, 'Enable Automatic Updates');
      console.log('');
      console.log(`  OnlyFence can automatically install new versions when available.`);
      console.log(
        `  ${dim('Updates are downloaded from GitHub releases and verified before installing.')}`,
      );
      console.log('');

      const updateChoice = await promptYesNo(
        `  ${cyan('?')} Enable automatic updates? ${dim('[Y/n]')}: `,
      );
      const autoInstall = updateChoice === 'y';

      updateConfigFile((raw) => {
        raw['update'] = { auto_install: autoInstall };
      });

      if (autoInstall) {
        success('Automatic updates enabled.');
      } else {
        info('Automatic updates disabled.');
      }
      info(`You can change this later in ${dim('config.toml [update]')}`);
    }

    // Step 6: Telemetry opt-in (only if not already configured)
    if (config.telemetry === undefined) {
      step(6, INTERACTIVE_STEPS, 'Anonymous Error Reporting');
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
    error(toErrorMessage(err));
    throw err;
  } finally {
    db?.close();
    rl.close();
    stdin.pause();
  }
}
