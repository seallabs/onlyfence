import type { Command } from 'commander';
import type { Chain } from '../../core/action-types.js';
import { ActivityQueryEngine, QueryValidationError } from '../../db/activity-query-engine.js';
import type {
  ActivityFilter,
  ActivityOrderBy,
  ActivityQueryInput,
} from '../../db/activity-query-tool.js';
import { toErrorMessage } from '../../utils/index.js';
import { getPrimaryWallet } from '../../wallet/manager.js';
import type { AppComponents } from '../bootstrap.js';
import { withComponents } from '../with-components.js';

/**
 * Register the `fence query` command group.
 *
 * Subcommands:
 * - `fence query price <tokens...>` - Query token prices via data provider
 * - `fence query balance [--chain sui]` - Query wallet balance via chain adapter
 */
export function registerQueryCommand(program: Command, getComponents: () => AppComponents): void {
  const queryCmd = program
    .command('query')
    .description('Query prices, balances, and activity history');

  // fence query price <tokens...>
  queryCmd
    .command('price <tokens...>')
    .description('Query token prices')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .option('-o, --output <format>', 'Output format (json|table)', 'table')
    .action(async (tokens: string[], options: { chain: Chain; output: string }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const { dataProviders, chainAdapterFactory } = components;
      const dataProvider = dataProviders.get(options.chain);
      const adapter = chainAdapterFactory.get(options.chain);

      const settled = await Promise.allSettled(
        tokens.map(async (token) => {
          const coinType = adapter.resolveTokenAddress(token);
          const symbol = adapter.resolveTokenSymbol(coinType);
          const price = await dataProvider.getPrice(coinType);
          return { token: symbol, priceUsd: price };
        }),
      );

      const results: { token: string; priceUsd: number | null; error?: string }[] = settled.map(
        (outcome, idx) => {
          if (outcome.status === 'fulfilled') {
            return outcome.value;
          }
          return {
            token: tokens[idx] ?? '',
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
    .action(async (options: { chain: Chain; output: string }) => {
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

  // fence query activities [options]
  queryCmd
    .command('activities')
    .description('Query activity history with flexible filtering and aggregation')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .option('-s, --select <columns>', 'Comma-separated columns or aggregations')
    .option('-f, --filter <expr>', 'Filter: column=op=value (repeatable)', collectRepeatable, [])
    .option('-g, --group-by <columns>', 'Comma-separated GROUP BY columns')
    .option('--having <expr>', 'Having filter: column=op=value (repeatable)', collectRepeatable, [])
    .option('--order-by <expr>', 'Order: column=asc|desc (repeatable)', collectRepeatable, [])
    .option('-l, --limit <n>', 'Max rows (1-1000)', '100')
    .option('--offset <n>', 'Rows to skip', '0')
    .option('--no-resolve-tokens', 'Skip coin_metadata join')
    .option('-o, --output <format>', 'Output format (json|table)', 'table')
    .action(
      (options: {
        chain: Chain;
        select?: string;
        filter: string[];
        groupBy?: string;
        having: string[];
        orderBy: string[];
        limit: string;
        offset: string;
        resolveTokens: boolean;
        output: string;
      }) => {
        const components = withComponents(getComponents);
        if (components === undefined) return;

        const { db, chainAdapterFactory } = components;

        try {
          const adapter = chainAdapterFactory.get(options.chain);
          const chainId = adapter.chainId;

          const filters: ActivityFilter[] = [
            { column: 'chain_id', op: 'eq', value: chainId },
            ...options.filter.map(parseFilterExpr),
          ];

          const select =
            options.select !== undefined
              ? options.select.split(',').map((s) => s.trim())
              : undefined;

          const groupBy =
            options.groupBy !== undefined
              ? options.groupBy.split(',').map((s) => s.trim())
              : undefined;

          const having =
            options.having.length > 0 ? options.having.map(parseFilterExpr) : undefined;

          const orderBy =
            options.orderBy.length > 0 ? options.orderBy.map(parseOrderByExpr) : undefined;

          const limit = parseInt(options.limit, 10);
          const offset = parseInt(options.offset, 10);

          if (Number.isNaN(limit)) {
            throw new Error('--limit must be a number');
          }
          if (Number.isNaN(offset)) {
            throw new Error('--offset must be a number');
          }

          const engine = new ActivityQueryEngine(db);
          // Commander's --no-resolve-tokens sets resolveTokens to false.
          // When not used, resolveTokens is true (Commander default).
          // We omit it to let the engine decide when the user didn't explicitly opt out.
          const result = engine.execute({
            ...buildOptionalFields(select, groupBy, having, orderBy, options.resolveTokens),
            filters,
            limit,
            offset,
          });

          if (options.output === 'json') {
            console.log(JSON.stringify(result, null, 2));
          } else {
            printActivityTable(result.columns, result.rows, result.totalCount);
          }
        } catch (err: unknown) {
          if (err instanceof QueryValidationError) {
            console.error(`Validation error (${err.field}): ${err.message}`);
            if (err.detail !== undefined) {
              console.error(`  ${err.detail}`);
            }
          } else {
            console.error(`Error: ${toErrorMessage(err)}`);
          }
          process.exitCode = 1;
        }
      },
    );
}

function buildOptionalFields(
  select: string[] | undefined,
  groupBy: string[] | undefined,
  having: ActivityFilter[] | undefined,
  orderBy: ActivityOrderBy[] | undefined,
  resolveTokens: boolean,
): Partial<ActivityQueryInput> {
  const result: { -readonly [K in keyof ActivityQueryInput]?: ActivityQueryInput[K] } = {};
  if (select !== undefined) result.select = select;
  if (groupBy !== undefined) result.groupBy = groupBy;
  if (having !== undefined) result.having = having;
  if (orderBy !== undefined) result.orderBy = orderBy;
  if (!resolveTokens) result.resolveTokens = false;
  return result;
}

function collectRepeatable(value: string, prev: string[]): string[] {
  return [...prev, value];
}

const VALID_FILTER_OPS = new Set<ActivityFilter['op']>([
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'in',
  'like',
  'between',
]);

function parseFilterExpr(expr: string): ActivityFilter {
  const first = expr.indexOf('=');
  if (first === -1) {
    throw new Error(`Invalid filter: "${expr}". Expected column=op=value`);
  }
  const second = expr.indexOf('=', first + 1);
  if (second === -1) {
    throw new Error(`Invalid filter: "${expr}". Expected column=op=value`);
  }
  const column = expr.substring(0, first);
  const op = expr.substring(first + 1, second);
  const rawValue = expr.substring(second + 1);

  if (!VALID_FILTER_OPS.has(op as ActivityFilter['op'])) {
    throw new Error(
      `Invalid operator "${op}" in filter "${expr}". Expected one of: ${[...VALID_FILTER_OPS].join(', ')}`,
    );
  }

  const value = parseFilterValue(rawValue, op as ActivityFilter['op']);
  return { column, op: op as ActivityFilter['op'], value };
}

function parseFilterValue(
  raw: string,
  op: ActivityFilter['op'],
): string | number | readonly (string | number)[] {
  if (op === 'in' || op === 'between') {
    return raw.split(',').map(parseScalar);
  }
  return parseScalar(raw);
}

function parseScalar(raw: string): string | number {
  const num = Number(raw);
  if (!Number.isNaN(num) && raw.trim() !== '') {
    return num;
  }
  return raw;
}

function parseOrderByExpr(expr: string): ActivityOrderBy {
  const lastEq = expr.lastIndexOf('=');
  if (lastEq === -1) {
    throw new Error(`Invalid order-by: "${expr}". Expected column=asc|desc`);
  }
  const column = expr.substring(0, lastEq);
  const direction = expr.substring(lastEq + 1);
  if (direction !== 'asc' && direction !== 'desc') {
    throw new Error(`Invalid direction "${direction}" in "${expr}". Expected asc or desc`);
  }
  return { column, direction };
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function printActivityTable(
  columns: string[],
  rows: Record<string, unknown>[],
  totalCount: number,
): void {
  if (rows.length === 0) {
    console.log('No results found.');
    return;
  }

  // Calculate column widths
  const widths = columns.map((col) => {
    const maxDataWidth = rows.reduce((max, row) => {
      const val = formatCellValue(row[col]);
      return Math.max(max, val.length);
    }, 0);
    return Math.max(col.length, maxDataWidth);
  });

  // Header
  const header = columns.map((col, i) => col.padEnd(widths[i] ?? col.length)).join('  ');
  const separator = columns.map((_col, i) => '─'.repeat(widths[i] ?? 1)).join('  ');
  console.log(header);
  console.log(separator);

  // Rows
  for (const row of rows) {
    const line = columns
      .map((col, i) => formatCellValue(row[col]).padEnd(widths[i] ?? 1))
      .join('  ');
    console.log(line);
  }

  console.log('');
  console.log(`${rows.length} of ${totalCount} rows`);
}
