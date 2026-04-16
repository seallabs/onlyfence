import type { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';
import { createSession, hasActiveSession } from '../../wallet/session.js';
import { toErrorMessage } from '../../utils/index.js';
import { resolveDefaultChain, resolveChainId } from '../resolve-chain.js';
import { promptSecret } from '../prompt.js';
import type { AppComponents } from '../bootstrap.js';

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
 * Creates time-limited sessions for ALL configured chains so subsequent
 * commands (e.g., `fence swap --chain solana`) can sign transactions without
 * re-entering the password.
 */
export function registerUnlockCommand(program: Command, getComponents: () => AppComponents): void {
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
          process.stderr.write('Warning: Active sessions exist. They will be replaced.\n');
        }

        const password = await promptSecret('Enter password: ');
        if (password.length === 0) {
          throw new Error('Password cannot be empty.');
        }

        // Resolve all configured chain IDs
        const config = loadConfig();
        void resolveDefaultChain(config); // validate at least one chain is configured

        const { chainAdapterFactory } = getComponents();
        const chains = Object.keys(config.chain);

        const unlocked: string[] = [];
        const failed: { chain: string; error: string }[] = [];

        for (const chain of chains) {
          try {
            const chainId = resolveChainId(chain, chainAdapterFactory);
            createSession(chainId, password, ttlSeconds);
            unlocked.push(chainId);
          } catch (err: unknown) {
            failed.push({ chain, error: toErrorMessage(err) });
          }
        }

        if (unlocked.length > 0) {
          process.stderr.write(
            `\u2713 Session active for ${unlocked.join(', ')} (expires in ${options.ttl})\n`,
          );
        }
        for (const { chain, error } of failed) {
          process.stderr.write(`\u26a0 Failed to unlock ${chain}: ${error}\n`);
        }

        if (unlocked.length === 0) {
          throw new Error('No chains could be unlocked.');
        }
      } catch (err: unknown) {
        process.stderr.write(`Error: ${toErrorMessage(err)}\n`);
        process.exitCode = 1;
      }
    });
}
