import type { Logger } from 'pino';
import type { Command } from 'commander';
import {
  fetchBluefinMarkets,
  resolveMarketSymbol,
  seedSyntheticCoinMetadata,
} from '../../chain/sui/bluefin-pro/markets.js';
import { syncFills } from '../../chain/sui/bluefin-pro/sync.js';
import { toE9, toBluefinCoinType } from '../../chain/sui/bluefin-pro/types.js';
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
  PerpWithdrawIntent,
  PipelineResult,
} from '../../core/action-types.js';
import { NoOpMevProtector } from '../../core/mev-protector.js';
import type { PipelineInput } from '../../core/transaction-pipeline.js';
import { executePipeline } from '../../core/transaction-pipeline.js';
import type { PolicyContext } from '../../policy/context.js';
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
import { EXIT_CODES, printJsonOutput } from '../output.js';
import { resolveTokenInput } from '../resolve.js';
import { withComponents } from '../with-components.js';

/** Shared fallback MEV protector for chains without a registered protector. */
const FALLBACK_MEV_PROTECTOR = new NoOpMevProtector();

// ---------------------------------------------------------------------------
// Shared helpers for transactional subcommands
// ---------------------------------------------------------------------------

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
 * Handle a pipeline error uniformly: log, print JSON error output, set exit code.
 */
function handlePipelineError(
  log: Logger,
  action: ActivityAction,
  chainId: ChainId,
  err: unknown,
  label: string,
): void {
  log.error({ err: toErrorMessage(err) }, `${label} failed`);
  const errorOutput: CliOutput = {
    status: 'error',
    action,
    chainId,
    address: '',
    error: toErrorMessage(err),
  };
  printJsonOutput(errorOutput);
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
): Omit<CliOutput, 'payload'> {
  return {
    status: result.status,
    action,
    chainId: intent.chainId,
    address: intent.walletAddress,
    gasUsed: result.gasUsed,
    txDigest: result.txDigest,
    protocol: 'bluefin_pro',
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
  payload: T | undefined,
): MappedOutput<T> {
  return {
    cliOutput: {
      ...buildCliOutputBase(result, action, intent),
      ...(payload !== undefined ? { payload } : {}),
    },
    exitCode: EXIT_CODES[result.status],
  };
}

/**
 * Register the `fence perp` command group on the given program.
 *
 * Subcommands:
 *   deposit <amount>                    — Deposit USDC to Bluefin margin bank
 *   withdraw <amount>                   — Withdraw USDC from margin bank
 *   order <market> <side> <qty>         — Place a perp order
 *   cancel <market>                     — Cancel orders
 *   positions                           — Query open positions
 *   orders                              — Query open orders
 *   markets                             — List available markets
 *   sync                                — Sync fills from API
 *   account                             — Show account summary
 */
export function registerPerpCommand(program: Command, getComponents: () => AppComponents): void {
  const perp = program.command('perp').description('Bluefin Pro perpetual futures operations');

  // --- Transactional subcommands ---
  registerDepositAction(perp, getComponents);
  registerWithdrawAction(perp, getComponents);
  registerOrderAction(perp, getComponents);
  registerCancelAction(perp, getComponents);

  // --- Query subcommands ---
  registerPositionsQuery(perp, getComponents);
  registerOrdersQuery(perp, getComponents);
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
    .description('Deposit USDC to Bluefin margin bank')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .action(async (amountStr: string, options: { chain: Chain }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const chain = options.chain;
      const chainId: ChainId = `${chain}:mainnet`;
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
            coinType: resolved.coinType,
            amount: resolved.scaledAmount,
            decimals: resolved.decimals,
          },
          ...(valueUsd !== undefined ? { valueUsd } : {}),
        };

        log.info(
          { amount: amountStr, chain, watchOnly: wallet.isWatchOnly },
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

        const output = mapDepositResult(result, intent, valueUsd);
        printJsonOutput(output.cliOutput);
        process.exitCode = output.exitCode;
      } catch (err: unknown) {
        handlePipelineError(log, 'perp:deposit', chainId, err, 'Perp deposit');
      }
    });
}

function registerWithdrawAction(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('withdraw <amount>')
    .description('Withdraw USDC from Bluefin margin bank')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .action(async (amountStr: string, options: { chain: Chain }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const chain = options.chain;
      const chainId: ChainId = `${chain}:mainnet`;
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
            assetSymbol: 'USDC',
            amountE9: toE9(amountStr),
          },
        };

        log.info(
          { amount: amountStr, chain, watchOnly: wallet.isWatchOnly },
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

        const output = mapWithdrawResult(result, intent);
        printJsonOutput(output.cliOutput);
        process.exitCode = output.exitCode;
      } catch (err: unknown) {
        handlePipelineError(log, 'perp:withdraw', chainId, err, 'Perp withdraw');
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
        },
      ) => {
        const components = withComponents(getComponents);
        if (components === undefined) return;

        const chain = options.chain;
        const chainId: ChainId = `${chain}:mainnet`;
        const log = components.logger.child({ command: 'perp-order' });

        try {
          const bluefinClient = components.getBluefinClient();
          const wallet = getPrimaryWallet(components.db, chainId);
          if (wallet === null) {
            throw new Error(
              `No primary wallet found for chain "${chainId}". Run "fence setup" first.`,
            );
          }

          log.info(
            { market, side, qty, orderType: options.type, chain, watchOnly: wallet.isWatchOnly },
            'Perp order invoked',
          );

          // Resolve market symbol
          const markets = await fetchBluefinMarkets(bluefinClient);
          const marketSymbol = resolveMarketSymbol(markets, market);
          const marketInfo = markets.find((m) => m.symbol === marketSymbol);

          // Resolve side
          const normalizedSide = side.toUpperCase();
          if (normalizedSide !== 'LONG' && normalizedSide !== 'SHORT') {
            throw new Error(`Invalid side "${side}". Must be LONG or SHORT.`);
          }

          // Resolve order type
          const normalizedOrderType = options.type.toUpperCase();
          if (normalizedOrderType !== 'MARKET' && normalizedOrderType !== 'LIMIT') {
            throw new Error(`Invalid order type "${options.type}". Must be MARKET or LIMIT.`);
          }

          // Validate limit price
          if (normalizedOrderType === 'LIMIT' && options.price === undefined) {
            throw new Error('Limit price (--price) is required for limit orders.');
          }

          // Build e9 values
          const quantityE9 = toE9(qty);
          const leverageE9 =
            options.leverage !== undefined
              ? toE9(options.leverage)
              : (marketInfo?.defaultLeverageE9 ?? toE9('1'));

          // Resolve time in force
          const tif = options.tif.toUpperCase();
          if (tif !== 'GTT' && tif !== 'IOC' && tif !== 'FOK') {
            throw new Error(`Invalid time in force "${options.tif}". Must be GTT, IOC, or FOK.`);
          }

          // USDC collateral coin type for policy checks
          const usdcCoinType = tryResolveTokenAddress('USDC');
          if (usdcCoinType === undefined) {
            throw new Error('Cannot resolve USDC coin type from token registry');
          }
          const marketCoinType = toBluefinCoinType(marketSymbol.split('-')[0] ?? marketSymbol);

          const intent: PerpPlaceOrderIntent = {
            chainId,
            action: 'perp:place_order',
            walletAddress: wallet.address,
            params: {
              marketSymbol,
              side: normalizedSide,
              quantityE9,
              orderType: normalizedOrderType,
              leverageE9,
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

          const output = mapOrderResult(result, intent);
          printJsonOutput(output.cliOutput);
          process.exitCode = output.exitCode;
        } catch (err: unknown) {
          handlePipelineError(log, 'perp:place_order', chainId, err, 'Perp order');
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
    .action(async (market: string, options: { order: string[]; chain: Chain }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const chain = options.chain;
      const chainId: ChainId = `${chain}:mainnet`;
      const log = components.logger.child({ command: 'perp-cancel' });

      try {
        const bluefinClient = components.getBluefinClient();
        const wallet = getPrimaryWallet(components.db, chainId);
        if (wallet === null) {
          throw new Error(
            `No primary wallet found for chain "${chainId}". Run "fence setup" first.`,
          );
        }

        log.info(
          { market, orderHashes: options.order, chain, watchOnly: wallet.isWatchOnly },
          'Perp cancel invoked',
        );

        // Resolve market symbol
        const markets = await fetchBluefinMarkets(bluefinClient);
        const marketSymbol = resolveMarketSymbol(markets, market);

        const intent: PerpCancelOrderIntent = {
          chainId,
          action: 'perp:cancel_order',
          walletAddress: wallet.address,
          params: {
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

        const output = mapCancelResult(result, intent);
        printJsonOutput(output.cliOutput);
        process.exitCode = output.exitCode;
      } catch (err: unknown) {
        handlePipelineError(log, 'perp:cancel_order', chainId, err, 'Perp cancel');
      }
    });
}

// --- Query subcommands ---

function registerPositionsQuery(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('positions')
    .description('Query open positions (live from API)')
    .action(async () => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const log = components.logger.child({ command: 'perp-positions' });

      try {
        const bluefinClient = components.getBluefinClient();
        const account = await bluefinClient.getAccountDetails();
        const positions = (account as unknown as Record<string, unknown>)['positions'] ?? [];
        console.log(
          JSON.stringify({ status: 'success', action: 'positions', data: positions }, null, 2),
        );
      } catch (err: unknown) {
        log.error({ err: toErrorMessage(err) }, 'Failed to fetch positions');
        const msg = enrichBluefinError(toErrorMessage(err));
        console.log(JSON.stringify({ status: 'error', error: msg }, null, 2));
        process.exitCode = 1;
      }
    });
}

function registerOrdersQuery(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('orders')
    .description('Query open orders (live from API)')
    .option('-m, --market <symbol>', 'Filter by market symbol')
    .action(async (options: { market?: string }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const log = components.logger.child({ command: 'perp-orders' });

      try {
        const bluefinClient = components.getBluefinClient();
        const symbol = options.market !== undefined ? options.market.toUpperCase() : undefined;
        const orders = await bluefinClient.getOpenOrders(symbol);
        console.log(JSON.stringify({ status: 'success', action: 'orders', data: orders }, null, 2));
      } catch (err: unknown) {
        log.error({ err: toErrorMessage(err) }, 'Failed to fetch orders');
        console.log(JSON.stringify({ status: 'error', error: toErrorMessage(err) }, null, 2));
        process.exitCode = 1;
      }
    });
}

function registerMarketsQuery(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('markets')
    .description('List available Bluefin Pro markets')
    .action(async () => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const log = components.logger.child({ command: 'perp-markets' });

      try {
        const bluefinClient = components.getBluefinClient();
        const markets = await fetchBluefinMarkets(bluefinClient);
        console.log(
          JSON.stringify({ status: 'success', action: 'markets', data: markets }, null, 2),
        );
      } catch (err: unknown) {
        log.error({ err: toErrorMessage(err) }, 'Failed to fetch markets');
        console.log(JSON.stringify({ status: 'error', error: toErrorMessage(err) }, null, 2));
        process.exitCode = 1;
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
    .action(
      async (
        market: string,
        options: { limit: string; start?: string; end?: string; page?: string },
      ) => {
        const components = withComponents(getComponents);
        if (components === undefined) return;

        const log = components.logger.child({ command: 'perp-funding-rate' });

        try {
          const bluefinClient = components.getBluefinClient();
          // Resolve market symbol
          const markets = await fetchBluefinMarkets(bluefinClient);
          const marketSymbol = resolveMarketSymbol(markets, market);

          const entries = await bluefinClient.getFundingRateHistory({
            symbol: marketSymbol,
            limit: parseInt(options.limit, 10),
            ...(options.start !== undefined
              ? { startTimeAtMillis: parseInt(options.start, 10) }
              : {}),
            ...(options.end !== undefined ? { endTimeAtMillis: parseInt(options.end, 10) } : {}),
            ...(options.page !== undefined ? { page: parseInt(options.page, 10) } : {}),
          });

          console.log(
            JSON.stringify(
              { status: 'success', action: 'funding-rate', market: marketSymbol, data: entries },
              null,
              2,
            ),
          );
        } catch (err: unknown) {
          log.error({ err: toErrorMessage(err) }, 'Failed to fetch funding rate history');
          console.log(JSON.stringify({ status: 'error', error: toErrorMessage(err) }, null, 2));
          process.exitCode = 1;
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
    .action(async (options: { limit: string; start?: string; end?: string; page?: string }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const log = components.logger.child({ command: 'perp-funding-history' });

      try {
        const bluefinClient = components.getBluefinClient();
        const history = await bluefinClient.getAccountFundingRateHistory({
          limit: parseInt(options.limit, 10),
          ...(options.start !== undefined
            ? { startTimeAtMillis: parseInt(options.start, 10) }
            : {}),
          ...(options.end !== undefined ? { endTimeAtMillis: parseInt(options.end, 10) } : {}),
          ...(options.page !== undefined ? { page: parseInt(options.page, 10) } : {}),
        });

        console.log(
          JSON.stringify(
            { status: 'success', action: 'funding-history', data: history.data },
            null,
            2,
          ),
        );
      } catch (err: unknown) {
        log.error({ err: toErrorMessage(err) }, 'Failed to fetch account funding history');
        console.log(JSON.stringify({ status: 'error', error: toErrorMessage(err) }, null, 2));
        process.exitCode = 1;
      }
    });
}

function registerSyncCommand(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('sync')
    .description('Sync filled trades from Bluefin API to local DB')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .action(async (options: { chain: Chain }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const { db, activityLog, coinMetadataRepo, logger } = components;
      const chain = options.chain;
      const chainId: ChainId = `${chain}:mainnet`;
      const log = logger.child({ command: 'perp-sync' });

      try {
        const bluefinClient = components.getBluefinClient();
        const wallet = getPrimaryWallet(db, chainId);
        if (wallet === null) {
          throw new Error(
            `No primary wallet found for chain "${chainId}". Run "fence setup" first.`,
          );
        }

        // Seed synthetic coin metadata before sync
        const markets = await fetchBluefinMarkets(bluefinClient);
        seedSyntheticCoinMetadata(markets, coinMetadataRepo, chainId);

        const result = await syncFills(
          bluefinClient,
          activityLog,
          coinMetadataRepo,
          chainId,
          wallet.address,
        );

        log.info({ synced: result.synced }, 'Fill sync complete');
        console.log(
          JSON.stringify({ status: 'success', action: 'sync', synced: result.synced }, null, 2),
        );
      } catch (err: unknown) {
        log.error({ err: toErrorMessage(err) }, 'Fill sync failed');
        console.log(JSON.stringify({ status: 'error', error: toErrorMessage(err) }, null, 2));
        process.exitCode = 1;
      }
    });
}

function registerAccountQuery(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('account')
    .description('Show Bluefin Pro account summary')
    .action(async () => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const log = components.logger.child({ command: 'perp-account' });

      try {
        const bluefinClient = components.getBluefinClient();
        const account = await bluefinClient.getAccountDetails();
        console.log(
          JSON.stringify({ status: 'success', action: 'account', data: account }, null, 2),
        );
      } catch (err: unknown) {
        log.error({ err: toErrorMessage(err) }, 'Failed to fetch account');
        const msg = enrichBluefinError(toErrorMessage(err));
        console.log(JSON.stringify({ status: 'error', error: msg }, null, 2));
        process.exitCode = 1;
      }
    });
}

// --- Result mapping ---

/** Whether the pipeline completed with a payload-worthy status. */
function hasPayload(result: PipelineResult): boolean {
  return result.status === 'success' || result.status === 'simulated';
}

function mapDepositResult(
  result: PipelineResult,
  intent: PerpDepositIntent,
  valueUsd: number | undefined,
): MappedOutput<PerpDepositOutput> {
  const payload: PerpDepositOutput | undefined = hasPayload(result)
    ? {
        token: intent.params.coinType,
        amount: parseFloat(intent.params.amount) / Math.pow(10, intent.params.decimals),
        valueUsd: valueUsd ?? null,
      }
    : undefined;

  return toMappedOutput(result, 'perp:deposit', intent, payload);
}

function mapWithdrawResult(
  result: PipelineResult,
  intent: PerpWithdrawIntent,
): MappedOutput<PerpWithdrawOutput> {
  const payload: PerpWithdrawOutput | undefined = hasPayload(result)
    ? {
        assetSymbol: intent.params.assetSymbol,
        amountE9: intent.params.amountE9,
        valueUsd: null,
      }
    : undefined;

  return toMappedOutput(result, 'perp:withdraw', intent, payload);
}

function mapOrderResult(
  result: PipelineResult,
  intent: PerpPlaceOrderIntent,
): MappedOutput<PerpOrderOutput> {
  const metadata = result.metadata;
  const payload: PerpOrderOutput | undefined = hasPayload(result)
    ? {
        marketSymbol: intent.params.marketSymbol,
        side: intent.params.side,
        orderType: intent.params.orderType,
        quantityE9: intent.params.quantityE9,
        leverageE9: intent.params.leverageE9,
        ...(intent.params.limitPriceE9 !== undefined
          ? { priceE9: intent.params.limitPriceE9 }
          : {}),
        ...(typeof metadata?.['orderHash'] === 'string'
          ? { orderHash: metadata['orderHash'] }
          : {}),
      }
    : undefined;

  return toMappedOutput(result, 'perp:place_order', intent, payload);
}

function mapCancelResult(
  result: PipelineResult,
  intent: PerpCancelOrderIntent,
): MappedOutput<PerpCancelOutput> {
  const cancelledCount =
    typeof result.metadata?.['cancelledCount'] === 'number' ? result.metadata['cancelledCount'] : 0;
  const payload: PerpCancelOutput | undefined = hasPayload(result)
    ? {
        marketSymbol: intent.params.marketSymbol,
        cancelledCount,
      }
    : undefined;

  return toMappedOutput(result, 'perp:cancel_order', intent, payload);
}

// --- Utilities ---

/**
 * Enrich generic Bluefin API errors with actionable hints.
 */
function enrichBluefinError(message: string): string {
  if (message.includes('status code 400')) {
    return `${message}. No Bluefin margin account found — deposit first with: fence perp deposit <amount>`;
  }
  return message;
}

/** Commander helper to collect repeatable option values into an array. */
function collectValues(value: string, prev: string[]): string[] {
  return [...prev, value];
}
