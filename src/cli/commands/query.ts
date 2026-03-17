import type { Command } from 'commander';
import type { AppComponents } from '../bootstrap.js';
import { getPrimaryWallet } from '../../wallet/manager.js';
import { toErrorMessage } from '../../utils/index.js';
import { withComponents } from '../with-components.js';

/**
 * Register the `fence query` command group.
 *
 * Subcommands:
 * - `fence query price <tokens...>` - Query token prices via oracle
 * - `fence query balance [--chain sui]` - Query wallet balance via chain adapter
 */
export function registerQueryCommand(program: Command, getComponents: () => AppComponents): void {
  const queryCmd = program.command('query').description('Query prices and balances');

  // fence query price <tokens...>
  queryCmd
    .command('price <tokens...>')
    .description('Query token prices via oracle')
    .option('-o, --output <format>', 'Output format (json|table)', 'table')
    .action(async (tokens: string[], options: { output: string }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const { oracle } = components;

      const settled = await Promise.allSettled(
        tokens.map(async (token) => {
          const price = await oracle.getPrice(token.toUpperCase());
          return { token: token.toUpperCase(), priceUsd: price };
        }),
      );

      const results: { token: string; priceUsd: number | null; error?: string }[] = settled.map(
        (outcome, idx) => {
          if (outcome.status === 'fulfilled') {
            return outcome.value;
          }
          return {
            token: (tokens[idx] ?? '').toUpperCase(),
            priceUsd: null,
            error: toErrorMessage(outcome.reason),
          };
        },
      );

      if (options.output === 'json') {
        console.log(JSON.stringify(results, null, 2));
      } else {
        // Table format
        console.log('Token          Price (USD)');
        console.log('─────          ───────────');
        for (const r of results) {
          const priceStr =
            r.priceUsd !== null ? `$${r.priceUsd.toFixed(4)}` : `Error: ${r.error ?? 'unknown'}`;
          console.log(`${r.token.padEnd(15)}${priceStr}`);
        }
      }
    });

  // fence query balance [--chain sui]
  queryCmd
    .command('balance')
    .description('Query wallet balance via chain adapter')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .option('-o, --output <format>', 'Output format (json|table)', 'table')
    .action(async (options: { chain: string; output: string }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const { db, chainAdapterFactory } = components;
      const chainAlias = options.chain;

      try {
        const adapter = chainAdapterFactory.get(chainAlias);
        const wallet = getPrimaryWallet(db, adapter.chainId);
        if (wallet === null) {
          throw new Error(
            `No primary wallet found for chain "${chainAlias}". Run "fence setup" first.`,
          );
        }
        const balanceResult = await adapter.getBalance(wallet.address);

        if (options.output === 'json') {
          // Serialize bigints as strings for JSON
          const serializable = {
            address: balanceResult.address,
            balances: balanceResult.balances.map((b) => ({
              token: b.token,
              amount: b.amount.toString(),
              decimals: b.decimals,
            })),
          };
          console.log(JSON.stringify(serializable, null, 2));
        } else {
          console.log(`Wallet: ${balanceResult.address}`);
          console.log(`Chain:  ${chainAlias}`);
          console.log('');
          console.log('Token          Amount               Decimals');
          console.log('─────          ──────               ────────');
          for (const b of balanceResult.balances) {
            console.log(
              `${b.token.padEnd(15)}${b.amount.toString().padEnd(21)}${String(b.decimals)}`,
            );
          }
        }
      } catch (err: unknown) {
        console.error(`Error: ${toErrorMessage(err)}`);
        process.exitCode = 1;
      }
    });
}
