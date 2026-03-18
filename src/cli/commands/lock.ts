import type { Command } from 'commander';
import { destroySession, hasActiveSession } from '../../wallet/session.js';
import { toErrorMessage } from '../../utils/index.js';

/**
 * Register the `fence lock` command.
 *
 * Destroys the active session immediately. Overwrites the session file
 * with zeros before deleting it for secure cleanup.
 */
export function registerLockCommand(program: Command): void {
  program
    .command('lock')
    .description('End the active session and lock your wallet')
    .action(() => {
      try {
        if (!hasActiveSession()) {
          process.stderr.write('No active session.\n');
          return;
        }

        destroySession();
        process.stderr.write('\u2713 Session ended.\n');
      } catch (err: unknown) {
        process.stderr.write(`Error: ${toErrorMessage(err)}\n`);
        process.exitCode = 1;
      }
    });
}
