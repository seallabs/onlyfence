import type { Command } from 'commander';
import type {
  ActivityAction,
  PerpCancelOrderIntent,
  PerpDepositIntent,
  PerpPlaceOrderIntent,
  PerpProtocol,
  PerpWithdrawIntent,
} from '../../core/action-types.js';
import { createActionExecutor, type ExecutionResult } from '../../core/action-executor.js';
import type { PerpProvider } from '../../core/perp-provider.js';
import { captureException } from '../../telemetry/index.js';
import { toE9 } from '../../utils/bigint.js';
import { toErrorMessage } from '../../utils/index.js';
import { getPrimaryWallet } from '../../wallet/manager.js';
import type { AppComponents } from '../bootstrap.js';
import type {
  ActionPayload,
  CliOutput,
  MappedOutput,
  PerpCancelOutput,
  PerpDepositOutput,
  PerpOrderOutput,
  PerpWithdrawOutput,
} from '../output.js';
import { EXIT_CODES, handleCommandError, printJsonOutput } from '../output.js';
import { resolveChainId, resolveDefaultChain } from '../resolve-chain.js';
import { withComponents } from '../with-components.js';

/** Default perp protocol when --protocol is not specified. */
const DEFAULT_PROTOCOL: PerpProtocol = 'bluefin_pro';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the PerpProvider from components based on the --protocol option.
 */
function resolveProvider(components: AppComponents, protocol: PerpProtocol): PerpProvider {
  return components.perpProviders.get(protocol);
}

/**
 * Write a successful query result to stdout.
 */
function writeQueryResult(action: string, data: unknown, extra?: Record<string, unknown>): void {
  process.stdout.write(
    JSON.stringify({ status: 'success', action, data, ...extra }, null, 2) + '\n',
  );
}

/**
 * Handle a query subcommand error: log, write JSON error to stdout, set exit code.
 */
function handleQueryError(
  log: { error: (obj: Record<string, unknown>, msg: string) => void },
  label: string,
  err: unknown,
  enrichFn?: (msg: string) => string,
): void {
  log.error({ err: toErrorMessage(err) }, `Failed to ${label}`);
  const msg = enrichFn !== undefined ? enrichFn(toErrorMessage(err)) : toErrorMessage(err);
  process.stdout.write(JSON.stringify({ status: 'error', error: msg }, null, 2) + '\n');
  process.exitCode = 1;
}

/**
 * Build the common CliOutput base from an ExecutionResult,
 * reducing repetition across the per-action result mappers.
 */
function buildCliOutputBase(
  execResult: ExecutionResult,
  action: ActivityAction,
  protocol: PerpProtocol,
): Omit<CliOutput, 'payload'> {
  const { pipelineResult: result, walletAddress } = execResult;
  const intent = execResult.resolvedIntent;
  return {
    status: result.status,
    action,
    chainId: intent.chainId,
    address: walletAddress,
    gasUsed: result.gasUsed,
    txDigest: result.txDigest,
    protocol,
    error: result.error,
    rejectionCheck: result.rejectionCheck,
    rejectionReason: result.rejectionReason,
  };
}

/**
 * Map an ExecutionResult to a MappedOutput with an optional payload.
 */
function toMappedOutput<T extends ActionPayload>(
  execResult: ExecutionResult,
  action: ActivityAction,
  protocol: PerpProtocol,
  payload: T | undefined,
): MappedOutput<T> {
  return {
    cliOutput: {
      ...buildCliOutputBase(execResult, action, protocol),
      ...(payload !== undefined ? { payload } : {}),
    },
    exitCode: EXIT_CODES[execResult.pipelineResult.status],
  };
}

/** Whether the pipeline completed with a payload-worthy status. */
function hasPayload(execResult: ExecutionResult): boolean {
  const s = execResult.pipelineResult.status;
  return s === 'success' || s === 'acknowledged' || s === 'simulated';
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the `fence perp` command group on the given program.
 *
 * Transactional subcommands are thin shells: parse args → build raw intent →
 * delegate to ActionExecutor → map result to CLI output.
 *
 * Execution mode (in-process vs daemon) is handled transparently
 * by the executor — commands have zero awareness of it.
 */
export function registerPerpCommand(program: Command, getComponents: () => AppComponents): void {
  const perp = program.command('perp').description('Perpetual futures operations');

  // --- Transactional subcommands ---
  registerDepositAction(perp, getComponents);
  registerWithdrawAction(perp, getComponents);
  registerOrderAction(perp, getComponents);
  registerCancelAction(perp, getComponents);
  registerCloseAction(perp, getComponents);

  // --- Query subcommands ---
  registerPositionsQuery(perp, getComponents);
  registerOrdersQuery(perp, getComponents);
  registerOrderStatusQuery(perp, getComponents);
  registerMarketsQuery(perp, getComponents);
  registerFundingRateQuery(perp, getComponents);
  registerAccountFundingQuery(perp, getComponents);
  registerSyncCommand(perp, getComponents);
  registerAccountQuery(perp, getComponents);
}

// ---------------------------------------------------------------------------
// Transactional subcommands
// ---------------------------------------------------------------------------

function registerDepositAction(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('deposit <amount>')
    .description('Deposit USDC to perp margin bank')
    .option('-c, --chain <chain>', 'Target chain')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(async (amountStr: string, options: { chain?: string; protocol: PerpProtocol }) => {
      const components = getComponents();
      const chain = options.chain ?? resolveDefaultChain(components.config);
      const chainId = resolveChainId(chain, components.chainAdapterFactory);
      const protocol = options.protocol;

      try {
        const executor = createActionExecutor(getComponents);

        // Raw intent: amount is human-readable, resolver handles scaling + coin type
        const rawIntent: PerpDepositIntent = {
          chainId,
          action: 'perp:deposit',
          walletAddress: '',
          params: {
            protocol,
            coinType: 'USDC', // resolver resolves to full coin type
            amount: amountStr, // resolver scales to smallest unit
            decimals: 0, // resolver fills from metadata
          },
        };

        const result = await executor.execute(rawIntent);
        const output = mapDepositResult(result, protocol);
        printJsonOutput(output.cliOutput);
        process.exitCode = output.exitCode;
      } catch (err: unknown) {
        handleCommandError(err, 'perp:deposit', chainId, captureException);
      }
    });
}

function registerWithdrawAction(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('withdraw <amount>')
    .description('Withdraw USDC from perp margin bank')
    .option('-c, --chain <chain>', 'Target chain')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(async (amountStr: string, options: { chain?: string; protocol: PerpProtocol }) => {
      const components = getComponents();
      const chain = options.chain ?? resolveDefaultChain(components.config);
      const chainId = resolveChainId(chain, components.chainAdapterFactory);
      const protocol = options.protocol;

      try {
        const executor = createActionExecutor(getComponents);

        const rawIntent: PerpWithdrawIntent = {
          chainId,
          action: 'perp:withdraw',
          walletAddress: '',
          params: {
            protocol,
            assetSymbol: 'USDC',
            amountE9: toE9(amountStr),
          },
        };

        const result = await executor.execute(rawIntent);
        const output = mapWithdrawResult(result, protocol);
        printJsonOutput(output.cliOutput);
        process.exitCode = output.exitCode;
      } catch (err: unknown) {
        handleCommandError(err, 'perp:withdraw', chainId, captureException);
      }
    });
}

function registerOrderAction(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('order <market> <side> <qty>')
    .description('Place a perp order (market or limit)')
    .option('-t, --type <orderType>', 'Order type (market or limit)', 'market')
    .option('-p, --price <price>', 'Limit price (required for limit orders)')
    .option('-l, --leverage <leverage>', 'Leverage multiplier')
    .option('-r, --reduce-only', 'Reduce-only flag')
    .option('--tif <tif>', 'Time in force (GTT, IOC, FOK)', 'GTT')
    .option('-c, --chain <chain>', 'Target chain')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(
      async (
        market: string,
        side: string,
        qty: string,
        options: {
          type: string;
          price?: string;
          leverage?: string;
          reduceOnly?: boolean;
          tif: string;
          chain?: string;
          protocol: PerpProtocol;
        },
      ) => {
        const cmps = getComponents();
        const chain = options.chain ?? resolveDefaultChain(cmps.config);
        const chainId = resolveChainId(chain, cmps.chainAdapterFactory);
        const protocol = options.protocol;

        try {
          // Validate CLI inputs before building intent
          const normalizedSide = side.toUpperCase();
          if (normalizedSide !== 'LONG' && normalizedSide !== 'SHORT') {
            throw new Error(`Invalid side "${side}". Must be LONG or SHORT.`);
          }

          const normalizedOrderType = options.type.toUpperCase();
          if (normalizedOrderType !== 'MARKET' && normalizedOrderType !== 'LIMIT') {
            throw new Error(`Invalid order type "${options.type}". Must be MARKET or LIMIT.`);
          }

          if (normalizedOrderType === 'LIMIT' && options.price === undefined) {
            throw new Error('Limit price (--price) is required for limit orders.');
          }

          const tif = options.tif.toUpperCase();
          if (tif !== 'GTT' && tif !== 'IOC' && tif !== 'FOK') {
            throw new Error(`Invalid time in force "${options.tif}". Must be GTT, IOC, or FOK.`);
          }

          const executor = createActionExecutor(getComponents);

          // Raw intent: market is user input, resolver handles resolution + coin types
          const rawIntent: PerpPlaceOrderIntent = {
            chainId,
            action: 'perp:place_order',
            walletAddress: '',
            params: {
              protocol,
              marketSymbol: market, // resolver resolves against exchange
              side: normalizedSide,
              quantityE9: toE9(qty),
              orderType: normalizedOrderType,
              ...(options.leverage !== undefined ? { leverageE9: toE9(options.leverage) } : {}),
              ...(options.price !== undefined ? { limitPriceE9: toE9(options.price) } : {}),
              ...(options.reduceOnly === true ? { reduceOnly: true } : {}),
              ...(tif !== 'GTT' ? { timeInForce: tif } : {}),
              collateralCoinType: '', // resolver fills
              marketCoinType: '', // resolver fills
            },
          };

          const result = await executor.execute(rawIntent);
          const output = mapOrderResult(result, protocol);
          printJsonOutput(output.cliOutput);
          process.exitCode = output.exitCode;
        } catch (err: unknown) {
          handleCommandError(err, 'perp:place_order', chainId, captureException);
        }
      },
    );
}

function registerCancelAction(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('cancel <market>')
    .description('Cancel orders for a market')
    .option('-o, --order <hash>', 'Specific order hash (repeatable)', collectValues, [])
    .option('-c, --chain <chain>', 'Target chain')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(
      async (
        market: string,
        options: { order: string[]; chain?: string; protocol: PerpProtocol },
      ) => {
        const cmps = getComponents();
        const chain = options.chain ?? resolveDefaultChain(cmps.config);
        const chainId = resolveChainId(chain, cmps.chainAdapterFactory);
        const protocol = options.protocol;

        try {
          const executor = createActionExecutor(getComponents);

          // Raw intent: market is user input, resolver resolves the symbol
          const rawIntent: PerpCancelOrderIntent = {
            chainId,
            action: 'perp:cancel_order',
            walletAddress: '',
            params: {
              protocol,
              marketSymbol: market, // resolver resolves against exchange
              ...(options.order.length > 0 ? { orderHashes: options.order } : {}),
            },
          };

          const result = await executor.execute(rawIntent);
          const output = mapCancelResult(result, protocol);
          printJsonOutput(output.cliOutput);
          process.exitCode = output.exitCode;
        } catch (err: unknown) {
          handleCommandError(err, 'perp:cancel_order', chainId, captureException);
        }
      },
    );
}

function registerCloseAction(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('close <market>')
    .description('Close an open position (fully or partially)')
    .option('-s, --size <qty>', 'Quantity to close (default: full position)')
    .option('-c, --chain <chain>', 'Target chain')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(
      async (
        market: string,
        options: {
          size?: string;
          chain?: string;
          protocol: PerpProtocol;
        },
      ) => {
        const components = withComponents(getComponents);
        if (components === undefined) return;

        const chain = options.chain ?? resolveDefaultChain(components.config);
        const chainId = resolveChainId(chain, components.chainAdapterFactory);
        const protocol = options.protocol;

        try {
          const provider = resolveProvider(components, protocol);

          // Parallelize market resolution and position fetch — they are independent
          const [marketSymbol, positions] = await Promise.all([
            provider.resolveMarket(market),
            provider.getPositions(),
          ]);

          const position = positions.find((p) => p.symbol === marketSymbol);
          if (position === undefined) {
            throw new Error(`No open position for market "${marketSymbol}"`);
          }

          // Determine opposite side and quantity
          const closeSide: 'LONG' | 'SHORT' = position.side === 'LONG' ? 'SHORT' : 'LONG';
          const closeQuantityE9 = options.size !== undefined ? toE9(options.size) : position.sizeE9;

          const executor = createActionExecutor(getComponents);

          // Build as a place_order with reduceOnly — the executor handles
          // market resolution, coin types, and perp policy context.
          const rawIntent: PerpPlaceOrderIntent = {
            chainId,
            action: 'perp:place_order',
            walletAddress: '',
            params: {
              protocol,
              marketSymbol, // already resolved above (needed for position lookup)
              side: closeSide,
              quantityE9: closeQuantityE9,
              orderType: 'MARKET',
              leverageE9: position.leverageE9,
              reduceOnly: true,
              collateralCoinType: '', // resolver fills
              marketCoinType: '', // resolver fills
            },
          };

          const result = await executor.execute(rawIntent);
          const output = mapOrderResult(result, protocol);
          printJsonOutput(output.cliOutput);
          process.exitCode = output.exitCode;
        } catch (err: unknown) {
          handleCommandError(err, 'perp:place_order', chainId, captureException);
        }
      },
    );
}

// ---------------------------------------------------------------------------
// Query subcommands
// ---------------------------------------------------------------------------

function registerPositionsQuery(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('positions')
    .description('Query open positions (live from API)')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(async (options: { protocol: PerpProtocol }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const log = components.logger.child({ command: 'perp-positions' });
      let provider: PerpProvider | undefined;

      try {
        provider = resolveProvider(components, options.protocol);
        const positions = await provider.getPositions();
        writeQueryResult('positions', positions);
      } catch (err: unknown) {
        handleQueryError(log, 'fetch positions', err, provider?.enrichError.bind(provider));
      }
    });
}

function registerOrdersQuery(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('orders')
    .description('Query open orders (live from API)')
    .option('-m, --market <symbol>', 'Filter by market symbol')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(async (options: { market?: string; protocol: PerpProtocol }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const log = components.logger.child({ command: 'perp-orders' });

      try {
        const provider = resolveProvider(components, options.protocol);
        const symbol = options.market !== undefined ? options.market.toUpperCase() : undefined;
        const orders = await provider.getOpenOrders(symbol);
        writeQueryResult('orders', orders);
      } catch (err: unknown) {
        handleQueryError(log, 'fetch orders', err);
      }
    });
}

function registerOrderStatusQuery(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('order-status <orderHash>')
    .description('Check the status of an order by hash')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(async (orderHash: string, options: { protocol: PerpProtocol }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const log = components.logger.child({ command: 'perp-order-status' });

      try {
        const provider = resolveProvider(components, options.protocol);

        const [openOrders, standbyOrders] = await Promise.all([
          provider.getOpenOrders(),
          provider.getStandbyOrders(),
        ]);

        const openMatch = openOrders.find((o) => o.orderHash === orderHash);
        if (openMatch !== undefined) {
          process.stdout.write(
            JSON.stringify(
              { status: 'success', action: 'order-status', source: 'open', data: openMatch },
              null,
              2,
            ) + '\n',
          );
          return;
        }

        const standbyMatch = standbyOrders.find((o) => o.orderHash === orderHash);
        if (standbyMatch !== undefined) {
          process.stdout.write(
            JSON.stringify(
              {
                status: 'success',
                action: 'order-status',
                source: 'standby',
                data: standbyMatch,
              },
              null,
              2,
            ) + '\n',
          );
          return;
        }

        throw new Error(`Order "${orderHash}" not found in open or standby orders`);
      } catch (err: unknown) {
        handleQueryError(log, 'fetch order status', err);
      }
    });
}

function registerMarketsQuery(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('markets')
    .description('List available perp markets')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(async (options: { protocol: PerpProtocol }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const log = components.logger.child({ command: 'perp-markets' });

      try {
        const provider = resolveProvider(components, options.protocol);
        const markets = await provider.getMarkets();
        const enriched = markets.map((m) => ({
          ...m,
          makerFeePercent: (Number(m.makerFeeE9) / 1e9) * 100,
          takerFeePercent: (Number(m.takerFeeE9) / 1e9) * 100,
        }));
        writeQueryResult('markets', enriched);
      } catch (err: unknown) {
        handleQueryError(log, 'fetch markets', err);
      }
    });
}

function registerFundingRateQuery(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('funding-rate <market>')
    .description('Query exchange-level funding rate history for a market')
    .option('-l, --limit <limit>', 'Max entries to return', '20')
    .option('--start <millis>', 'Start time in milliseconds since epoch')
    .option('--end <millis>', 'End time in milliseconds since epoch')
    .option('--page <page>', 'Page number for pagination')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(
      async (
        market: string,
        options: {
          limit: string;
          start?: string;
          end?: string;
          page?: string;
          protocol: PerpProtocol;
        },
      ) => {
        const components = withComponents(getComponents);
        if (components === undefined) return;

        const log = components.logger.child({ command: 'perp-funding-rate' });

        try {
          const provider = resolveProvider(components, options.protocol);
          const marketSymbol = await provider.resolveMarket(market);

          const entries = await provider.getFundingRateHistory(marketSymbol, {
            limit: parseInt(options.limit, 10),
            ...(options.start !== undefined
              ? { startTimeAtMillis: parseInt(options.start, 10) }
              : {}),
            ...(options.end !== undefined ? { endTimeAtMillis: parseInt(options.end, 10) } : {}),
            ...(options.page !== undefined ? { page: parseInt(options.page, 10) } : {}),
          });

          const enriched = entries.map((e) => ({
            ...e,
            fundingRateApr:
              e.fundingIntervalHours > 0
                ? (Number(e.fundingRateE9) / 1e9) * (8760 / e.fundingIntervalHours) * 100
                : 0,
          }));

          writeQueryResult('funding-rate', enriched, { market: marketSymbol });
        } catch (err: unknown) {
          handleQueryError(log, 'fetch funding rate history', err);
        }
      },
    );
}

function registerAccountFundingQuery(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('funding-history')
    .description('Query account-level funding rate payment history')
    .option('-l, --limit <limit>', 'Max entries to return', '20')
    .option('--start <millis>', 'Start time in milliseconds since epoch')
    .option('--end <millis>', 'End time in milliseconds since epoch')
    .option('--page <page>', 'Page number for pagination')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(
      async (options: {
        limit: string;
        start?: string;
        end?: string;
        page?: string;
        protocol: PerpProtocol;
      }) => {
        const components = withComponents(getComponents);
        if (components === undefined) return;

        const log = components.logger.child({ command: 'perp-funding-history' });

        try {
          const provider = resolveProvider(components, options.protocol);
          const history = await provider.getAccountFundingHistory({
            limit: parseInt(options.limit, 10),
            ...(options.start !== undefined
              ? { startTimeAtMillis: parseInt(options.start, 10) }
              : {}),
            ...(options.end !== undefined ? { endTimeAtMillis: parseInt(options.end, 10) } : {}),
            ...(options.page !== undefined ? { page: parseInt(options.page, 10) } : {}),
          });

          writeQueryResult('funding-history', history);
        } catch (err: unknown) {
          handleQueryError(log, 'fetch account funding history', err);
        }
      },
    );
}

function registerSyncCommand(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('sync')
    .description('Sync filled trades from perp API to local DB')
    .option('-c, --chain <chain>', 'Target chain')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(async (options: { chain?: string; protocol: PerpProtocol }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const { db, activityLog, coinMetadataRepo, logger } = components;
      const chain = options.chain ?? resolveDefaultChain(components.config);
      const chainId = resolveChainId(chain, components.chainAdapterFactory);
      const protocol = options.protocol;
      const log = logger.child({ command: 'perp-sync' });

      try {
        const provider = resolveProvider(components, protocol);
        const wallet = getPrimaryWallet(db, chainId);
        if (wallet === null) {
          throw new Error(
            `No primary wallet found for chain "${chainId}". Run "fence setup" first.`,
          );
        }

        // Seed synthetic coin metadata before sync
        await provider.seedCoinMetadata(coinMetadataRepo, chainId);

        const result = await provider.syncFills(
          activityLog,
          coinMetadataRepo,
          chainId,
          wallet.address,
          log,
        );

        log.info({ synced: result.synced }, 'Fill sync complete');
        writeQueryResult('sync', undefined, { synced: result.synced });
      } catch (err: unknown) {
        handleQueryError(log, 'sync fills', err);
      }
    });
}

function registerAccountQuery(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('account')
    .description('Show perp account summary')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(async (options: { protocol: PerpProtocol }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const log = components.logger.child({ command: 'perp-account' });
      let provider: PerpProvider | undefined;

      try {
        provider = resolveProvider(components, options.protocol);
        const account = await provider.getAccount();
        writeQueryResult('account', account);
      } catch (err: unknown) {
        handleQueryError(log, 'fetch account', err, provider?.enrichError.bind(provider));
      }
    });
}

// ---------------------------------------------------------------------------
// Result mapping
// ---------------------------------------------------------------------------

function mapDepositResult(
  execResult: ExecutionResult,
  protocol: PerpProtocol,
): MappedOutput<PerpDepositOutput> {
  const intent = execResult.resolvedIntent as PerpDepositIntent;
  const payload: PerpDepositOutput | undefined = hasPayload(execResult)
    ? {
        token: intent.params.coinType,
        amount: parseFloat(intent.params.amount) / Math.pow(10, intent.params.decimals),
        valueUsd: execResult.tradeValueUsd ?? null,
      }
    : undefined;

  return toMappedOutput(execResult, 'perp:deposit', protocol, payload);
}

function mapWithdrawResult(
  execResult: ExecutionResult,
  protocol: PerpProtocol,
): MappedOutput<PerpWithdrawOutput> {
  const intent = execResult.resolvedIntent as PerpWithdrawIntent;
  const payload: PerpWithdrawOutput | undefined = hasPayload(execResult)
    ? {
        assetSymbol: intent.params.assetSymbol,
        amountE9: intent.params.amountE9,
        valueUsd: null,
      }
    : undefined;

  return toMappedOutput(execResult, 'perp:withdraw', protocol, payload);
}

function mapOrderResult(
  execResult: ExecutionResult,
  protocol: PerpProtocol,
): MappedOutput<PerpOrderOutput> {
  const intent = execResult.resolvedIntent as PerpPlaceOrderIntent;
  const metadata = execResult.pipelineResult.metadata;
  const payload: PerpOrderOutput | undefined = hasPayload(execResult)
    ? {
        marketSymbol: intent.params.marketSymbol,
        side: intent.params.side,
        orderType: intent.params.orderType,
        quantityE9: intent.params.quantityE9,
        ...(intent.params.leverageE9 !== undefined ? { leverageE9: intent.params.leverageE9 } : {}),
        ...(intent.params.limitPriceE9 !== undefined
          ? { priceE9: intent.params.limitPriceE9 }
          : {}),
        ...(typeof metadata?.['orderHash'] === 'string'
          ? { orderHash: metadata['orderHash'] }
          : {}),
      }
    : undefined;

  return toMappedOutput(execResult, 'perp:place_order', protocol, payload);
}

function mapCancelResult(
  execResult: ExecutionResult,
  protocol: PerpProtocol,
): MappedOutput<PerpCancelOutput> {
  const intent = execResult.resolvedIntent as PerpCancelOrderIntent;
  const cancelledCount =
    typeof execResult.pipelineResult.metadata?.['cancelledCount'] === 'number'
      ? execResult.pipelineResult.metadata['cancelledCount']
      : 0;
  const payload: PerpCancelOutput | undefined = hasPayload(execResult)
    ? {
        marketSymbol: intent.params.marketSymbol,
        cancelledCount,
      }
    : undefined;

  return toMappedOutput(execResult, 'perp:cancel_order', protocol, payload);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Commander helper to collect repeatable option values into an array. */
function collectValues(value: string, prev: string[]): string[] {
  return [...prev, value];
}
