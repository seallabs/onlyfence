/**
 * Secure password prompt for the terminal.
 *
 * Uses raw mode to prevent the password from appearing on screen.
 * Output goes to stderr so it doesn't pollute JSON stdout.
 */
export function promptPassword(prompt: string): Promise<string> {
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
