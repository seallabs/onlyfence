import type { Command } from 'commander';
import { SUI_CHAIN_ID } from '../../chain/sui/adapter.js';
import { createSession, hasActiveSession } from '../../wallet/session.js';
import { toErrorMessage } from '../../utils/index.js';

/** Allowed TTL values and their seconds equivalent. */
const TTL_MAP: Record<string, number> = {
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '8h': 28800,
  '12h': 43200,
  '24h': 86400,
};

/**
 * Prompt for a password from the terminal with echo disabled.
 *
 * Uses raw mode to prevent the password from appearing on screen.
 * Output goes to stderr so it doesn't pollute JSON stdout.
 */
function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof process.stdin.setRawMode !== 'function') {
      reject(new Error('Cannot securely read password: terminal does not support raw mode.'));
      return;
    }

    process.stderr.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let password = '';

    const cleanup = (): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stderr.write('\n');
    };

    const onData = (ch: string): void => {
      const c = ch;

      if (c === '\n' || c === '\r' || c === '\u0004') {
        // Enter or Ctrl+D — submit
        cleanup();
        resolve(password);
      } else if (c === '\u0003') {
        // Ctrl+C — cancel
        cleanup();
        reject(new Error('Password entry cancelled.'));
      } else if (c === '\u007F' || c === '\b') {
        // Backspace
        password = password.slice(0, -1);
      } else {
        password += c;
      }
    };

    process.stdin.on('data', onData);
  });
}

/**
 * Register the `fence unlock` command.
 *
 * Creates a time-limited session so subsequent commands (e.g., `fence swap`)
 * can sign transactions without re-entering the password.
 */
export function registerUnlockCommand(program: Command): void {
  program
    .command('unlock')
    .description('Unlock your wallet for a session (default: 4h)')
    .option('--ttl <duration>', 'Session duration (1h, 2h, 4h, 8h, 12h, 24h)', '4h')
    .action(async (options: { ttl: string }) => {
      try {
        // Validate TTL
        const ttlSeconds = TTL_MAP[options.ttl];
        if (ttlSeconds === undefined) {
          const allowed = Object.keys(TTL_MAP).join(', ');
          throw new Error(`Invalid TTL "${options.ttl}". Allowed values: ${allowed}`);
        }

        // Require interactive terminal
        if (!process.stdin.isTTY) {
          throw new Error(
            'fence unlock requires an interactive terminal to securely enter your password.',
          );
        }

        if (hasActiveSession()) {
          process.stderr.write('Warning: An active session already exists. It will be replaced.\n');
        }

        const password = await promptPassword('Enter password: ');
        if (password.length === 0) {
          throw new Error('Password cannot be empty.');
        }

        // Default to Sui — the only supported chain in standalone mode
        const chain = SUI_CHAIN_ID;
        createSession(chain, password, ttlSeconds);

        process.stderr.write(`\u2713 Session active (expires in ${options.ttl})\n`);
      } catch (err: unknown) {
        process.stderr.write(`Error: ${toErrorMessage(err)}\n`);
        process.exitCode = 1;
      }
    });
}
