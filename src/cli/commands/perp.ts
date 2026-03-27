import type { Command } from 'commander';
import type { Logger } from 'pino';
import { buildSuiSigner } from '../../chain/sui/signer.js';
import { tryResolveTokenAddress } from '../../chain/sui/tokens.js';
import type { ActionBuilder } from '../../core/action-builder.js';
import type {
  ActionIntent,
  ActionIntentBase,
  ActivityAction,
  Chain,
  ChainId,
  PerpCancelOrderIntent,
  PerpDepositIntent,
  PerpPlaceOrderIntent,
  PerpProtocol,
  PerpWithdrawIntent,
  PipelineResult,
} from '../../core/action-types.js';
import { NoOpMevProtector } from '../../core/mev-protector.js';
import type { PerpProvider } from '../../core/perp-provider.js';
import type { PipelineInput } from '../../core/transaction-pipeline.js';
import { executePipeline } from '../../core/transaction-pipeline.js';
import type { PolicyContext } from '../../policy/context.js';
import { captureException } from '../../telemetry/index.js';
import { toE9 } from '../../utils/bigint.js';
import { toErrorMessage } from '../../utils/index.js';
import { getPrimaryWallet } from '../../wallet/manager.js';
import { loadSessionKeyBytes } from '../../wallet/session.js';
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
import { resolveTokenInput } from '../resolve.js';
import { withComponents } from '../with-components.js';

/** Shared fallback MEV protector for chains without a registered protector. */
const FALLBACK_MEV_PROTECTOR = new NoOpMevProtector();

/** Default perp protocol when --protocol is not specified. */
const DEFAULT_PROTOCOL: PerpProtocol = 'bluefin_pro';

// ---------------------------------------------------------------------------
// Shared helpers for transactional subcommands
// ---------------------------------------------------------------------------

/**
 * Resolve the PerpProvider from components based on the --protocol option.
 */
function resolveProvider(components: AppComponents, protocol: PerpProtocol): PerpProvider {
  return components.perpProviders.get(protocol);
}

/**
 * Prepare the common pipeline dependencies shared by all perp transactional
 * commands: wallet lookup, signer, builder, MEV protector.
 */
function preparePipeline(
  components: AppComponents,
  chain: Chain,
  chainId: ChainId,
  action: ActivityAction,
  intent: ActionIntent,
): {
  watchOnly: boolean;
  pipelineInput: Omit<PipelineInput, 'logger'>;
} {
  const {
    db,
    config,
    policyRegistry,
    activityLog,
    chainAdapterFactory,
    actionBuilderRegistry,
    mevProtectors,
  } = components;

  const wallet = getPrimaryWallet(db, chainId);
  if (wallet === null) {
    throw new Error(`No primary wallet found for chain "${chainId}". Run "fence setup" first.`);
  }

  const watchOnly = wallet.isWatchOnly;
  const signer = watchOnly ? undefined : buildSuiSigner(loadSessionKeyBytes(chainId));
  const chainAdapter = chainAdapterFactory.get(chain);
  const builder = actionBuilderRegistry.getDefault(chain, action, intent);
  const mevProtector = mevProtectors.get(chain) ?? FALLBACK_MEV_PROTECTOR;

  const chainConfig = config.chain[chain];
  const policyCtx: PolicyContext = {
    config: chainConfig,
    activityLog,
  };

  return {
    watchOnly,
    pipelineInput: {
      intent,
      builder,
      chainAdapter,
      policyRegistry,
      policyContext: policyCtx,
      mevProtector,
      ...(signer !== undefined ? { signer } : {}),
      watchOnly,
    },
  };
}

/**
 * Handle a query subcommand error: log, write JSON error to stdout, set exit code.
 */
function handleQueryError(
  log: Logger,
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
 * Build the common CliOutput base from a PipelineResult and intent,
 * reducing repetition across the per-action result mappers.
 */
function buildCliOutputBase(
  result: PipelineResult,
  action: ActivityAction,
  intent: ActionIntentBase,
  protocol: PerpProtocol,
): Omit<CliOutput, 'payload'> {
  return {
    status: result.status,
    action,
    chainId: intent.chainId,
    address: intent.walletAddress,
    gasUsed: result.gasUsed,
    txDigest: result.txDigest,
    protocol,
    error: result.error,
    rejectionCheck: result.rejectionCheck,
    rejectionReason: result.rejectionReason,
  };
}

/**
 * Map a PipelineResult to a MappedOutput with an optional payload.
 */
function toMappedOutput<T extends ActionPayload>(
  result: PipelineResult,
  action: ActivityAction,
  intent: ActionIntentBase,
  protocol: PerpProtocol,
  payload: T | undefined,
): MappedOutput<T> {
  return {
    cliOutput: {
      ...buildCliOutputBase(result, action, intent, protocol),
      ...(payload !== undefined ? { payload } : {}),
    },
    exitCode: EXIT_CODES[result.status],
  };
}

/**
 * Register the `fence perp` command group on the given program.
 *
 * Subcommands:
 *   deposit <amount>                    -- Deposit USDC to perp margin bank
 *   withdraw <amount>                   -- Withdraw USDC from margin bank
 *   order <market> <side> <qty>         -- Place a perp order
 *   cancel <market>                     -- Cancel orders
 *   positions                           -- Query open positions
 *   orders                              -- Query open orders
 *   markets                             -- List available markets
 *   sync                                -- Sync fills from API
 *   account                             -- Show account summary
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

// --- Transactional subcommands ---

function registerDepositAction(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('deposit <amount>')
    .description('Deposit USDC to perp margin bank')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(async (amountStr: string, options: { chain: Chain; protocol: PerpProtocol }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const chain = options.chain;
      const chainId: ChainId = `${chain}:mainnet`;
      const protocol = options.protocol;
      const log = components.logger.child({ command: 'perp-deposit' });

      try {
        const chainAdapter = components.chainAdapterFactory.get(chain);
        const dataProvider = components.dataProviders.get(chain);

        // Resolve USDC token input
        const resolved = await resolveTokenInput('USDC', amountStr, chainAdapter, dataProvider);

        // Get USD value
        const valueUsd = await dataProvider
          .getPrice(resolved.coinType)
          .then((price) => parseFloat(amountStr) * price)
          .catch((err: unknown) => {
            log.warn({ error: toErrorMessage(err) }, 'Price unavailable for deposit');
            return undefined;
          });

        const wallet = getPrimaryWallet(components.db, chainId);
        if (wallet === null) {
          throw new Error(
            `No primary wallet found for chain "${chainId}". Run "fence setup" first.`,
          );
        }

        const intent: PerpDepositIntent = {
          chainId,
          action: 'perp:deposit',
          walletAddress: wallet.address,
          params: {
            protocol,
            coinType: resolved.coinType,
            amount: resolved.scaledAmount,
            decimals: resolved.decimals,
          },
          ...(valueUsd !== undefined ? { valueUsd } : {}),
        };

        log.info(
          { amount: amountStr, chain, protocol, watchOnly: wallet.isWatchOnly },
          'Perp deposit invoked',
        );

        // Deposit needs custom policyContext (tradeValueUsd) and dataProvider,
        // so we inline pipeline setup rather than using preparePipeline.
        const watchOnly = wallet.isWatchOnly;
        const signer = watchOnly ? undefined : buildSuiSigner(loadSessionKeyBytes(chainId));
        const builder = components.actionBuilderRegistry.getDefault(
          chain,
          'perp:deposit',
          intent,
        ) as ActionBuilder<PerpDepositIntent>;
        const mevProtector = components.mevProtectors.get(chain) ?? FALLBACK_MEV_PROTECTOR;

        const policyCtx: PolicyContext = {
          config: components.config.chain[chain],
          activityLog: components.activityLog,
          ...(valueUsd !== undefined ? { tradeValueUsd: valueUsd } : {}),
        };

        const result = await executePipeline({
          intent,
          builder,
          chainAdapter,
          policyRegistry: components.policyRegistry,
          policyContext: policyCtx,
          mevProtector,
          logger: log,
          ...(signer !== undefined ? { signer } : {}),
          watchOnly,
          dataProvider,
        });

        const output = mapDepositResult(result, intent, protocol, valueUsd);
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
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(async (amountStr: string, options: { chain: Chain; protocol: PerpProtocol }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const chain = options.chain;
      const chainId: ChainId = `${chain}:mainnet`;
      const protocol = options.protocol;
      const log = components.logger.child({ command: 'perp-withdraw' });

      try {
        const wallet = getPrimaryWallet(components.db, chainId);
        if (wallet === null) {
          throw new Error(
            `No primary wallet found for chain "${chainId}". Run "fence setup" first.`,
          );
        }

        const intent: PerpWithdrawIntent = {
          chainId,
          action: 'perp:withdraw',
          walletAddress: wallet.address,
          params: {
            protocol,
            assetSymbol: 'USDC',
            amountE9: toE9(amountStr),
          },
        };

        log.info(
          { amount: amountStr, chain, protocol, watchOnly: wallet.isWatchOnly },
          'Perp withdraw invoked',
        );

        const { pipelineInput } = preparePipeline(
          components,
          chain,
          chainId,
          'perp:withdraw',
          intent,
        );
        const result = await executePipeline({ ...pipelineInput, logger: log });

        const output = mapWithdrawResult(result, intent, protocol);
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
    .option('-c, --chain <chain>', 'Target chain', 'sui')
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
          chain: Chain;
          protocol: PerpProtocol;
        },
      ) => {
        const components = withComponents(getComponents);
        if (components === undefined) return;

        const chain = options.chain;
        const chainId: ChainId = `${chain}:mainnet`;
        const protocol = options.protocol;
        const log = components.logger.child({ command: 'perp-order' });

        try {
          const provider = resolveProvider(components, protocol);
          const wallet = getPrimaryWallet(components.db, chainId);
          if (wallet === null) {
            throw new Error(
              `No primary wallet found for chain "${chainId}". Run "fence setup" first.`,
            );
          }

          log.info(
            {
              market,
              side,
              qty,
              orderType: options.type,
              chain,
              protocol,
              watchOnly: wallet.isWatchOnly,
            },
            'Perp order invoked',
          );

          const marketSymbol = await provider.resolveMarket(market);

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

          const quantityE9 = toE9(qty);
          const leverageE9 = options.leverage !== undefined ? toE9(options.leverage) : undefined;

          const tif = options.tif.toUpperCase();
          if (tif !== 'GTT' && tif !== 'IOC' && tif !== 'FOK') {
            throw new Error(`Invalid time in force "${options.tif}". Must be GTT, IOC, or FOK.`);
          }

          // USDC collateral coin type for policy checks
          const usdcCoinType = tryResolveTokenAddress('USDC');
          if (usdcCoinType === undefined) {
            throw new Error('Cannot resolve USDC coin type from token registry');
          }
          const marketCoinType = provider.toMarketCoinType(
            marketSymbol.split('-')[0] ?? marketSymbol,
          );

          const intent: PerpPlaceOrderIntent = {
            chainId,
            action: 'perp:place_order',
            walletAddress: wallet.address,
            params: {
              protocol,
              marketSymbol,
              side: normalizedSide,
              quantityE9,
              orderType: normalizedOrderType,
              ...(leverageE9 !== undefined ? { leverageE9 } : {}),
              ...(options.price !== undefined ? { limitPriceE9: toE9(options.price) } : {}),
              ...(options.reduceOnly === true ? { reduceOnly: true } : {}),
              ...(tif !== 'GTT' ? { timeInForce: tif } : {}),
              collateralCoinType: usdcCoinType,
              marketCoinType,
            },
          };

          const { pipelineInput } = preparePipeline(
            components,
            chain,
            chainId,
            'perp:place_order',
            intent,
          );
          const result = await executePipeline({ ...pipelineInput, logger: log });

          const output = mapOrderResult(result, intent, protocol);
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
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(
      async (
        market: string,
        options: { order: string[]; chain: Chain; protocol: PerpProtocol },
      ) => {
        const components = withComponents(getComponents);
        if (components === undefined) return;

        const chain = options.chain;
        const chainId: ChainId = `${chain}:mainnet`;
        const protocol = options.protocol;
        const log = components.logger.child({ command: 'perp-cancel' });

        try {
          const provider = resolveProvider(components, protocol);
          const wallet = getPrimaryWallet(components.db, chainId);
          if (wallet === null) {
            throw new Error(
              `No primary wallet found for chain "${chainId}". Run "fence setup" first.`,
            );
          }

          log.info(
            { market, orderHashes: options.order, chain, protocol, watchOnly: wallet.isWatchOnly },
            'Perp cancel invoked',
          );

          // Resolve market symbol
          const marketSymbol = await provider.resolveMarket(market);

          const intent: PerpCancelOrderIntent = {
            chainId,
            action: 'perp:cancel_order',
            walletAddress: wallet.address,
            params: {
              protocol,
              marketSymbol,
              ...(options.order.length > 0 ? { orderHashes: options.order } : {}),
            },
          };

          const { pipelineInput } = preparePipeline(
            components,
            chain,
            chainId,
            'perp:cancel_order',
            intent,
          );
          const result = await executePipeline({ ...pipelineInput, logger: log });

          const output = mapCancelResult(result, intent, protocol);
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
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(
      async (
        market: string,
        options: {
          size?: string;
          chain: Chain;
          protocol: PerpProtocol;
        },
      ) => {
        const components = withComponents(getComponents);
        if (components === undefined) return;

        const chain = options.chain;
        const chainId: ChainId = `${chain}:mainnet`;
        const protocol = options.protocol;
        const log = components.logger.child({ command: 'perp-close' });

        try {
          const provider = resolveProvider(components, protocol);
          const wallet = getPrimaryWallet(components.db, chainId);
          if (wallet === null) {
            throw new Error(
              `No primary wallet found for chain "${chainId}". Run "fence setup" first.`,
            );
          }

          // Resolve market symbol
          const marketSymbol = await provider.resolveMarket(market);

          // Fetch positions and find the one for this market
          const positions = await provider.getPositions();
          const position = positions.find((p) => p.symbol === marketSymbol);
          if (position === undefined) {
            throw new Error(`No open position for market "${marketSymbol}"`);
          }

          // Determine opposite side and quantity
          const closeSide: 'LONG' | 'SHORT' = position.side === 'LONG' ? 'SHORT' : 'LONG';
          const closeQuantityE9 = options.size !== undefined ? toE9(options.size) : position.sizeE9;

          // USDC collateral coin type
          const usdcCoinType = tryResolveTokenAddress('USDC');
          if (usdcCoinType === undefined) {
            throw new Error('Cannot resolve USDC coin type from token registry');
          }
          const marketCoinType = provider.toMarketCoinType(
            marketSymbol.split('-')[0] ?? marketSymbol,
          );

          const intent: PerpPlaceOrderIntent = {
            chainId,
            action: 'perp:place_order',
            walletAddress: wallet.address,
            params: {
              protocol,
              marketSymbol,
              side: closeSide,
              quantityE9: closeQuantityE9,
              orderType: 'MARKET',
              leverageE9: position.leverageE9,
              reduceOnly: true,
              collateralCoinType: usdcCoinType,
              marketCoinType,
            },
          };

          log.info(
            {
              market: marketSymbol,
              side: closeSide,
              qty: closeQuantityE9,
              chain,
              protocol,
              watchOnly: wallet.isWatchOnly,
            },
            'Perp close invoked',
          );

          const { pipelineInput } = preparePipeline(
            components,
            chain,
            chainId,
            'perp:place_order',
            intent,
          );
          const result = await executePipeline({ ...pipelineInput, logger: log });

          const output = mapOrderResult(result, intent, protocol);
          printJsonOutput(output.cliOutput);
          process.exitCode = output.exitCode;
        } catch (err: unknown) {
          handleCommandError(err, 'perp:place_order', chainId, captureException);
        }
      },
    );
}

// --- Query subcommands ---

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
        process.stdout.write(
          JSON.stringify({ status: 'success', action: 'positions', data: positions }, null, 2) +
            '\n',
        );
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
        process.stdout.write(
          JSON.stringify({ status: 'success', action: 'orders', data: orders }, null, 2) + '\n',
        );
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
        process.stdout.write(
          JSON.stringify({ status: 'success', action: 'markets', data: enriched }, null, 2) + '\n',
        );
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
          // Resolve market symbol
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
            fundingRateApr: (Number(e.fundingRateE9) / 1e9) * (8760 / e.fundingIntervalHours) * 100,
          }));

          process.stdout.write(
            JSON.stringify(
              { status: 'success', action: 'funding-rate', market: marketSymbol, data: enriched },
              null,
              2,
            ) + '\n',
          );
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

          process.stdout.write(
            JSON.stringify(
              {
                status: 'success',
                action: 'funding-history',
                data: history,
              },
              null,
              2,
            ) + '\n',
          );
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
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .option('--protocol <protocol>', 'Perp protocol', DEFAULT_PROTOCOL)
    .action(async (options: { chain: Chain; protocol: PerpProtocol }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const { db, activityLog, coinMetadataRepo, logger } = components;
      const chain = options.chain;
      const chainId: ChainId = `${chain}:mainnet`;
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
        process.stdout.write(
          JSON.stringify({ status: 'success', action: 'sync', synced: result.synced }, null, 2) +
            '\n',
        );
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
        process.stdout.write(
          JSON.stringify({ status: 'success', action: 'account', data: account }, null, 2) + '\n',
        );
      } catch (err: unknown) {
        handleQueryError(log, 'fetch account', err, provider?.enrichError.bind(provider));
      }
    });
}

// --- Result mapping ---

/** Whether the pipeline completed with a payload-worthy status. */
function hasPayload(result: PipelineResult): boolean {
  return (
    result.status === 'success' || result.status === 'acknowledged' || result.status === 'simulated'
  );
}

function mapDepositResult(
  result: PipelineResult,
  intent: PerpDepositIntent,
  protocol: PerpProtocol,
  valueUsd: number | undefined,
): MappedOutput<PerpDepositOutput> {
  const payload: PerpDepositOutput | undefined = hasPayload(result)
    ? {
        token: intent.params.coinType,
        amount: parseFloat(intent.params.amount) / Math.pow(10, intent.params.decimals),
        valueUsd: valueUsd ?? null,
      }
    : undefined;

  return toMappedOutput(result, 'perp:deposit', intent, protocol, payload);
}

function mapWithdrawResult(
  result: PipelineResult,
  intent: PerpWithdrawIntent,
  protocol: PerpProtocol,
): MappedOutput<PerpWithdrawOutput> {
  const payload: PerpWithdrawOutput | undefined = hasPayload(result)
    ? {
        assetSymbol: intent.params.assetSymbol,
        amountE9: intent.params.amountE9,
        valueUsd: null,
      }
    : undefined;

  return toMappedOutput(result, 'perp:withdraw', intent, protocol, payload);
}

function mapOrderResult(
  result: PipelineResult,
  intent: PerpPlaceOrderIntent,
  protocol: PerpProtocol,
): MappedOutput<PerpOrderOutput> {
  const metadata = result.metadata;
  const payload: PerpOrderOutput | undefined = hasPayload(result)
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

  return toMappedOutput(result, 'perp:place_order', intent, protocol, payload);
}

function mapCancelResult(
  result: PipelineResult,
  intent: PerpCancelOrderIntent,
  protocol: PerpProtocol,
): MappedOutput<PerpCancelOutput> {
  const cancelledCount =
    typeof result.metadata?.['cancelledCount'] === 'number' ? result.metadata['cancelledCount'] : 0;
  const payload: PerpCancelOutput | undefined = hasPayload(result)
    ? {
        marketSymbol: intent.params.marketSymbol,
        cancelledCount,
      }
    : undefined;

  return toMappedOutput(result, 'perp:cancel_order', intent, protocol, payload);
}

// --- Utilities ---

/** Commander helper to collect repeatable option values into an array. */
function collectValues(value: string, prev: string[]): string[] {
  return [...prev, value];
}
