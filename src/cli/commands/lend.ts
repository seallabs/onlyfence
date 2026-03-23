import type { Command } from 'commander';
import {
  fetchAllMarkets,
  fetchMarketDetail,
  fetchPortfolio,
  resolveMarketId,
} from '../../chain/sui/alphalend/markets.js';
import { buildSuiSigner } from '../../chain/sui/signer.js';
import type { ActionBuilder } from '../../core/action-builder.js';
import type {
  BorrowIntent,
  Chain,
  ChainId,
  ClaimRewardsIntent,
  PipelineResult,
  RepayIntent,
  SupplyIntent,
  WithdrawIntent,
} from '../../core/action-types.js';
import { NoOpMevProtector } from '../../core/mev-protector.js';
import { executePipeline } from '../../core/transaction-pipeline.js';
import type { PolicyContext } from '../../policy/context.js';
import { captureException } from '../../telemetry/index.js';
import { toErrorMessage } from '../../utils/index.js';
import { getPrimaryWallet } from '../../wallet/manager.js';
import { loadSessionKeyBytes } from '../../wallet/session.js';
import type { AppComponents } from '../bootstrap.js';
import type { CliOutput, LendingOutput, LendingRewardsOutput, MappedOutput } from '../output.js';
import { EXIT_CODES, printJsonOutput } from '../output.js';
import { resolveTokenInput } from '../resolve.js';
import { withComponents } from '../with-components.js';

/** Shared fallback MEV protector for chains without a registered protector. */
const FALLBACK_MEV_PROTECTOR = new NoOpMevProtector();

/** Lending actions that take token + amount args. */
type LendingAction = 'lending:supply' | 'lending:borrow' | 'lending:withdraw' | 'lending:repay';

/** Intent type for a token-based lending action. */
type TokenLendingIntent = SupplyIntent | BorrowIntent | WithdrawIntent | RepayIntent;

/**
 * Register the `fence lend` command group on the given program.
 *
 * Subcommands:
 *   supply <token> <amount>   - Supply tokens as collateral
 *   borrow <token> <amount>   - Borrow tokens against collateral
 *   withdraw <token> <amount> - Withdraw supplied tokens
 *   repay <token> <amount>    - Repay borrowed tokens
 *   claim                     - Claim accumulated rewards
 *   markets                   - List all lending markets
 *   market <token>            - Show detailed market info
 *   portfolio                 - Show user lending positions
 */
export function registerLendCommand(program: Command, getComponents: () => AppComponents): void {
  const lend = program.command('lend').description('AlphaLend lending operations');

  // --- Transactional subcommands ---
  registerTokenAction(
    lend,
    'supply',
    'lending:supply',
    'Supply tokens as collateral',
    getComponents,
  );
  registerTokenAction(
    lend,
    'borrow',
    'lending:borrow',
    'Borrow tokens against collateral',
    getComponents,
  );
  registerWithdrawAction(lend, getComponents);
  registerTokenAction(lend, 'repay', 'lending:repay', 'Repay borrowed tokens', getComponents);
  registerClaimAction(lend, getComponents);

  // --- Query subcommands ---
  registerMarketsQuery(lend, getComponents);
  registerMarketDetailQuery(lend, getComponents);
  registerPortfolioQuery(lend, getComponents);
}

/**
 * Register a token-based lending subcommand (supply, borrow, repay).
 * All share the same flow: resolve token, scale amount, resolve market, build intent, execute pipeline.
 */
function registerTokenAction(
  parent: Command,
  commandName: string,
  action: LendingAction,
  description: string,
  getComponents: () => AppComponents,
): void {
  parent
    .command(`${commandName} <token> <amount>`)
    .description(description)
    .option('-m, --market <marketId>', 'Explicit market ID (auto-resolved if omitted)')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .action(
      async (token: string, amountStr: string, options: { market?: string; chain: Chain }) => {
        await executeTokenLendingAction(action, token, amountStr, options, getComponents);
      },
    );
}

/**
 * Register the withdraw subcommand with an additional --all flag.
 */
function registerWithdrawAction(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('withdraw <token> <amount>')
    .description('Withdraw supplied tokens')
    .option('-m, --market <marketId>', 'Explicit market ID (auto-resolved if omitted)')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .option('-a, --all', 'Withdraw entire position')
    .action(
      async (
        token: string,
        amountStr: string,
        options: { market?: string; chain: Chain; all?: boolean },
      ) => {
        await executeTokenLendingAction(
          'lending:withdraw',
          token,
          amountStr,
          options,
          getComponents,
        );
      },
    );
}

/**
 * Core transactional flow shared by supply, borrow, withdraw, repay.
 */
async function executeTokenLendingAction(
  action: LendingAction,
  token: string,
  amountStr: string,
  options: { market?: string; chain: Chain; all?: boolean },
  getComponents: () => AppComponents,
): Promise<void> {
  const components = withComponents(getComponents);
  if (components === undefined) return;

  const {
    db,
    config,
    dataProviders,
    policyRegistry,
    activityLog,
    chainAdapterFactory,
    actionBuilderRegistry,
    mevProtectors,
    alphalendClient,
    logger,
  } = components;
  const chain = options.chain;
  const chainId: ChainId = `${chain}:mainnet`;
  const log = logger.child({ command: `lend-${action}` });

  try {
    const chainConfig = config.chain[chain];

    const wallet = getPrimaryWallet(db, chainId);
    if (wallet === null) {
      throw new Error(`No primary wallet found for chain "${chainId}". Run "fence setup" first.`);
    }

    const watchOnly = wallet.isWatchOnly;

    log.info({ action, token, amount: amountStr, chain, watchOnly }, 'Lend command invoked');

    // Get chain adapter and data provider
    const chainAdapter = chainAdapterFactory.get(chain);
    const dataProvider = dataProviders.get(chain);

    // === Resolve CLI inputs to stable internal representations ===
    // resolveTokenInput handles alias resolution (case-insensitive),
    // coin type normalization, decimal fetching, and amount scaling.
    const resolved = await resolveTokenInput(token, amountStr, chainAdapter, dataProvider);
    const { coinType, scaledAmount } = resolved;

    // Resolve market ID and USD price in parallel (independent operations)
    // PriceCache (wrapping the data provider) implements fail-closed:
    // if the oracle is unreachable and the cache is stale (>5 min),
    // getPrice() throws OracleStalePriceError — the trade is rejected.
    const [marketId, tradeValueUsd] = await Promise.all([
      resolveMarketId(alphalendClient, coinType, options.market),
      dataProvider.getPrice(coinType).then((price) => parseFloat(amountStr) * price),
    ]);

    // Build intent
    const intent = buildTokenIntent(
      action,
      chainId,
      wallet.address,
      coinType,
      scaledAmount,
      marketId,
      tradeValueUsd,
      options.all,
    );

    // Build policy context
    const policyCtx: PolicyContext = {
      config: chainConfig,
      activityLog,
      tradeValueUsd,
    };

    // Resolve signer from active session if not watch-only
    const signer = watchOnly ? undefined : buildSuiSigner(loadSessionKeyBytes(chainId));

    // Get builder from registry
    const builder = actionBuilderRegistry.getDefault(
      chain,
      action,
      intent,
    ) as ActionBuilder<TokenLendingIntent>;

    // Get MEV protector (fallback to NoOp)
    const mevProtector = mevProtectors.get(chain) ?? FALLBACK_MEV_PROTECTOR;

    // Execute pipeline
    const result = await executePipeline({
      intent,
      builder,
      chainAdapter,
      policyRegistry,
      policyContext: policyCtx,
      mevProtector,
      logger: log,
      ...(signer !== undefined ? { signer } : {}),
      watchOnly,
      dataProvider,
    });

    // Map PipelineResult to CliOutput + exit code
    const output = mapLendingResultToOutput(result, intent, action, tradeValueUsd);
    printJsonOutput(output.cliOutput);
    process.exitCode = output.exitCode;
  } catch (err: unknown) {
    log.error({ err }, `Lend ${action} failed`);
    captureException(err);
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
}

/**
 * Build the correct intent type for a given lending action.
 */
function buildTokenIntent(
  action: LendingAction,
  chainId: ChainId,
  walletAddress: string,
  coinType: string,
  amount: string,
  marketId: string,
  tradeValueUsd: number | undefined,
  withdrawAll?: boolean,
): TokenLendingIntent {
  const base = {
    chainId,
    walletAddress,
    ...(tradeValueUsd !== undefined ? { tradeValueUsd } : {}),
  } as const;

  switch (action) {
    case 'lending:supply': {
      const intent: SupplyIntent = {
        ...base,
        action: 'lending:supply',
        params: { coinType, amount, protocol: 'alphalend', marketId },
      };
      return intent;
    }
    case 'lending:borrow': {
      const intent: BorrowIntent = {
        ...base,
        action: 'lending:borrow',
        params: { coinType, amount, protocol: 'alphalend', marketId },
      };
      return intent;
    }
    case 'lending:withdraw': {
      const intent: WithdrawIntent = {
        ...base,
        action: 'lending:withdraw',
        params: {
          coinType,
          amount,
          protocol: 'alphalend',
          marketId,
          ...(withdrawAll === true ? { withdrawAll: true } : {}),
        },
      };
      return intent;
    }
    case 'lending:repay': {
      const intent: RepayIntent = {
        ...base,
        action: 'lending:repay',
        params: { coinType, amount, protocol: 'alphalend', marketId },
      };
      return intent;
    }
  }
}

/**
 * Register the claim rewards subcommand.
 */
function registerClaimAction(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('claim')
    .description('Claim accumulated lending rewards')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .action(async (options: { chain: Chain }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const {
        db,
        config,
        dataProviders,
        policyRegistry,
        activityLog,
        chainAdapterFactory,
        actionBuilderRegistry,
        mevProtectors,
        logger,
      } = components;
      const chain = options.chain;
      const chainId: ChainId = `${chain}:mainnet`;
      const log = logger.child({ command: 'lend-claim' });

      try {
        const chainConfig = config.chain[chain];

        const wallet = getPrimaryWallet(db, chainId);
        if (wallet === null) {
          throw new Error(
            `No primary wallet found for chain "${chainId}". Run "fence setup" first.`,
          );
        }

        const watchOnly = wallet.isWatchOnly;
        log.info({ chain, watchOnly }, 'Claim rewards invoked');

        const intent: ClaimRewardsIntent = {
          chainId,
          action: 'lending:claim_rewards',
          walletAddress: wallet.address,
          params: { protocol: 'alphalend' },
        };

        const policyCtx: PolicyContext = {
          config: chainConfig,
          activityLog,
        };

        const signer = watchOnly ? undefined : buildSuiSigner(loadSessionKeyBytes(chainId));

        const builder = actionBuilderRegistry.getDefault(
          chain,
          'lending:claim_rewards',
          intent,
        ) as ActionBuilder<ClaimRewardsIntent>;

        const chainAdapter = chainAdapterFactory.get(chain);
        const mevProtector = mevProtectors.get(chain) ?? FALLBACK_MEV_PROTECTOR;

        const result = await executePipeline({
          intent,
          builder,
          chainAdapter,
          policyRegistry,
          policyContext: policyCtx,
          mevProtector,
          logger: log,
          ...(signer !== undefined ? { signer } : {}),
          watchOnly,
          dataProvider: dataProviders.get(chain),
        });

        const output = mapLendingResultToOutput(result, intent, 'lending:claim_rewards', undefined);
        printJsonOutput(output.cliOutput);
        process.exitCode = output.exitCode;
      } catch (err: unknown) {
        log.error({ err: toErrorMessage(err) }, 'Claim rewards failed');
        const errorOutput: CliOutput = {
          status: 'error',
          action: 'lending:claim_rewards',
          chainId,
          address: '',
          error: toErrorMessage(err),
        };
        printJsonOutput(errorOutput);
        process.exitCode = 1;
      }
    });
}

// --- Query subcommands ---

/**
 * Register the `lend markets` query subcommand.
 */
function registerMarketsQuery(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('markets')
    .description('List all AlphaLend markets')
    .action(async () => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const { alphalendClient, logger } = components;
      const log = logger.child({ command: 'lend-markets' });

      try {
        const markets = await fetchAllMarkets(alphalendClient);
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

/**
 * Register the `lend market <token>` query subcommand.
 */
function registerMarketDetailQuery(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('market <token>')
    .description('Show detailed info for a single market')
    .action(async (token: string) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const { alphalendClient, chainAdapterFactory, logger } = components;
      const log = logger.child({ command: 'lend-market' });

      try {
        const chainAdapter = chainAdapterFactory.get('sui');
        const coinType = chainAdapter.resolveTokenAddress(token);
        const detail = await fetchMarketDetail(alphalendClient, coinType);
        console.log(JSON.stringify({ status: 'success', action: 'market', data: detail }, null, 2));
      } catch (err: unknown) {
        log.error({ err: toErrorMessage(err) }, 'Failed to fetch market detail');
        console.log(JSON.stringify({ status: 'error', error: toErrorMessage(err) }, null, 2));
        process.exitCode = 1;
      }
    });
}

/**
 * Register the `lend portfolio` query subcommand.
 */
function registerPortfolioQuery(parent: Command, getComponents: () => AppComponents): void {
  parent
    .command('portfolio')
    .description('Show user lending portfolio')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .action(async (options: { chain: Chain }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const { db, alphalendClient, logger } = components;
      const chain = options.chain;
      const chainId: ChainId = `${chain}:mainnet`;
      const log = logger.child({ command: 'lend-portfolio' });

      try {
        const wallet = getPrimaryWallet(db, chainId);
        if (wallet === null) {
          throw new Error(
            `No primary wallet found for chain "${chainId}". Run "fence setup" first.`,
          );
        }

        const portfolio = await fetchPortfolio(alphalendClient, wallet.address);
        console.log(
          JSON.stringify({ status: 'success', action: 'portfolio', data: portfolio }, null, 2),
        );
      } catch (err: unknown) {
        log.error({ err: toErrorMessage(err) }, 'Failed to fetch portfolio');
        console.log(JSON.stringify({ status: 'error', error: toErrorMessage(err) }, null, 2));
        process.exitCode = 1;
      }
    });
}

// --- Result mapping ---

/** Lending payload union */
type LendingPayload = LendingOutput | LendingRewardsOutput;

/**
 * Map a PipelineResult to a CliOutput and process exit code for lending actions.
 */
function mapLendingResultToOutput(
  result: PipelineResult,
  intent: TokenLendingIntent | ClaimRewardsIntent,
  action: LendingAction | 'lending:claim_rewards',
  tradeValueUsd: number | undefined,
): MappedOutput<LendingPayload> {
  const base: CliOutput<LendingPayload> = {
    status: result.status,
    action,
    chainId: intent.chainId,
    address: intent.walletAddress,
    gasUsed: result.gasUsed,
    txDigest: result.txDigest,
    protocol: 'alphalend',
    error: result.error,
    rejectionCheck: result.rejectionCheck,
    rejectionReason: result.rejectionReason,
  };

  const hasPayload = result.status === 'success' || result.status === 'simulated';
  let payload: LendingPayload | undefined;

  if (hasPayload && intent.action !== 'lending:claim_rewards') {
    payload = {
      token: intent.params.coinType,
      amount: parseFloat(intent.params.amount),
      marketId: intent.params.marketId,
      valueUsd: tradeValueUsd ?? null,
    };
  }

  return {
    cliOutput: { ...base, ...(payload !== undefined ? { payload } : {}) },
    exitCode: EXIT_CODES[result.status],
  };
}
