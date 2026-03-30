import type { Command } from 'commander';
import { createSession, hasActiveSession } from '../../wallet/session.js';
import { toErrorMessage } from '../../utils/index.js';
import type { AppComponents } from '../bootstrap.js';
import { promptSecret } from '../prompt.js';

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
 * Register the `fence unlock` command.
 *
 * Creates a time-limited session so subsequent commands (e.g., `fence swap`)
 * can sign transactions without re-entering the password.
 */
export function registerUnlockCommand(program: Command, getComponents: () => AppComponents): void {
  program
    .command('unlock')
    .description('Unlock your wallet for a session (default: 4h)')
    .option('--ttl <duration>', 'Session duration (1h, 2h, 4h, 8h, 12h, 24h)', '4h')
    .option('-c, --chain <chain>', 'Target chain')
    .action(async (options: { ttl: string; chain?: string }) => {
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

        const password = await promptSecret('Enter password: ');
        if (password.length === 0) {
          throw new Error('Password cannot be empty.');
        }

        // Resolve chain from option or first configured chain
        const components = getComponents();
        const chainName = options.chain ?? Object.keys(components.config.chain)[0];
        if (chainName === undefined) {
          throw new Error('No chains configured. Run "fence config init" first.');
        }
        const chainId = components.chainRegistry.get(chainName).defaultChainId;
        createSession(chainId, password, ttlSeconds);

        process.stderr.write(`\u2713 Session active (expires in ${options.ttl})\n`);
      } catch (err: unknown) {
        process.stderr.write(`Error: ${toErrorMessage(err)}\n`);
        process.exitCode = 1;
      }
    });
}
