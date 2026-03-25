import { stdin, stdout, stderr } from 'node:process';
import { MIN_PASSWORD_LENGTH } from '../wallet/keystore.js';
import { warn } from './style.js';

/** Options for secret input prompts. */
export interface PromptSecretOptions {
  /** Write prompt/mask to stderr instead of stdout (avoids polluting structured output). */
  readonly stderr?: boolean;
}

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
 * Prompt for hidden input from the terminal with echo disabled.
 *
 * Uses raw mode so the input is not visible on screen.
 * Each keystroke is masked with a bullet character for visual feedback.
 *
 * @param prompt - The prompt text to display
 * @returns The entered string
 * @throws Error if the user cancels with Ctrl+C
 */
export function promptSecret(prompt: string, options?: PromptSecretOptions): Promise<string> {
  const out = options?.stderr === true ? stderr : stdout;
  return withRawMode(() => {
    out.write(prompt);

    return new Promise<string>((resolve) => {
      let buf = '';
      const onData = (key: Buffer): void => {
        const ch = key.toString('utf8');

        if (ch === KEY.ENTER_CR || ch === KEY.ENTER_LF) {
          stdin.removeListener('data', onData);
          stdin.pause();
          out.write('\n');
          resolve(buf);
        } else if (ch === KEY.BACKSPACE_DEL || ch === KEY.BACKSPACE_BS) {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            out.write('\b \b');
          }
        } else if (ch === KEY.CTRL_C) {
          stdin.removeListener('data', onData);
          stdin.pause();
          out.write('\n');
          process.exit(130);
        } else if (!ch.startsWith(KEY.ESCAPE)) {
          buf += ch;
          out.write('•');
        }
      };

      stdin.on('data', onData);
    });
  });
}

/**
 * Prompt for a password with retry on validation failure.
 * Loops until the user provides a password meeting the minimum length.
 *
 * @param prompt - The prompt text to display
 * @returns A valid password string
 */
export async function promptPasswordWithRetry(prompt: string): Promise<string> {
  for (;;) {
    const password = await promptSecret(prompt);
    if (password.length >= MIN_PASSWORD_LENGTH) {
      return password;
    }
    warn(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  }
}

/**
 * Prompt for a single-key y/n input using raw stdin.
 * Returns the lowercase key pressed ('y' or 'n').
 * Any key other than y/Y defaults to 'n'.
 */
export async function promptYesNo(prompt: string): Promise<'y' | 'n'> {
  return withRawMode(() => {
    stdout.write(prompt);

    return new Promise<'y' | 'n'>((resolve) => {
      const onData = (key: Buffer): void => {
        const ch = key.toString('utf8');

        if (ch === KEY.CTRL_C) {
          stdin.removeListener('data', onData);
          stdin.pause();
          stdout.write('\n');
          process.exit(130);
        }

        stdin.removeListener('data', onData);
        stdin.pause();

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
