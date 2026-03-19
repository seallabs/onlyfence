import type { Command } from 'commander';
import { resolveTokenAddress, scaleToSmallestUnit } from '../../chain/sui/tokens.js';
import {
  fetchAllMarkets,
  fetchMarketDetail,
  fetchPortfolio,
  resolveMarketId,
} from '../../chain/sui/alphalend/markets.js';
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
import { toErrorMessage } from '../../utils/index.js';
import { getPrimaryWallet } from '../../wallet/manager.js';
import { loadSessionKeyBytes } from '../../wallet/session.js';
import { buildSuiSigner } from '../../chain/sui/signer.js';
import type { AppComponents } from '../bootstrap.js';
import type {
  CliOutput,
  ErrorResponse,
  LendingSimulatedResponse,
  LendingSuccessResponse,
  RejectionResponse,
} from '../output.js';
import { printJsonOutput } from '../output.js';
import { withComponents } from '../with-components.js';

/** Shared fallback MEV protector for chains without a registered protector. */
const FALLBACK_MEV_PROTECTOR = new NoOpMevProtector();

/** Lending actions that take token + amount args. */
type LendingAction = 'supply' | 'borrow' | 'withdraw' | 'repay';

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
  registerTokenAction(lend, 'supply', 'Supply tokens as collateral', getComponents);
  registerTokenAction(lend, 'borrow', 'Borrow tokens against collateral', getComponents);
  registerWithdrawAction(lend, getComponents);
  registerTokenAction(lend, 'repay', 'Repay borrowed tokens', getComponents);
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
  action: LendingAction,
  description: string,
  getComponents: () => AppComponents,
): void {
  parent
    .command(`${action} <token> <amount>`)
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
        await executeTokenLendingAction('withdraw', token, amountStr, options, getComponents);
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
    oracle,
    policyRegistry,
    tradeLog,
    chainAdapterFactory,
    actionBuilderRegistry,
    mevProtectors,
    coinMetadataService,
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

    // === Resolve CLI inputs to stable internal representations ===
    const coinType = resolveTokenAddress(token.toUpperCase());
    const decimals = await coinMetadataService.getDecimals(coinType, chain);
    const scaledAmount = scaleToSmallestUnit(amountStr, decimals);

    // Resolve market ID (auto from coinType or explicit)
    const marketId = await resolveMarketId(alphalendClient, coinType, options.market);

    // Resolve USD price from oracle
    let tradeValueUsd: number | undefined;
    try {
      const price = await oracle.getPrice(token.toUpperCase());
      tradeValueUsd = parseFloat(amountStr) * price;
    } catch (err: unknown) {
      log.warn(
        { token, error: toErrorMessage(err) },
        'Oracle price unavailable; USD spending limits will not be enforced',
      );
      tradeValueUsd = undefined;
    }

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
      oracle,
      tradeLog,
      ...(tradeValueUsd !== undefined ? { tradeValueUsd } : {}),
    };

    // Resolve signer from active session if not watch-only
    const signer = watchOnly ? undefined : buildSuiSigner(loadSessionKeyBytes(chainId));

    // Get builder from registry
    const builder = actionBuilderRegistry.getDefault(
      chain,
      action,
      intent,
    ) as ActionBuilder<TokenLendingIntent>;

    // Get chain adapter
    const chainAdapter = chainAdapterFactory.get(chain);

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
    });

    // Map PipelineResult to CliOutput + exit code
    const output = mapLendingResultToOutput(result, intent, action, tradeValueUsd);
    printJsonOutput(output.cliOutput);
    process.exitCode = output.exitCode;
  } catch (err: unknown) {
    log.error({ err: toErrorMessage(err) }, `Lend ${action} failed`);
    const errorOutput: ErrorResponse = {
      status: 'error',
      message: toErrorMessage(err),
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
    case 'supply': {
      const intent: SupplyIntent = {
        ...base,
        action: 'supply',
        params: { coinType, amount, protocol: 'alphalend', marketId },
      };
      return intent;
    }
    case 'borrow': {
      const intent: BorrowIntent = {
        ...base,
        action: 'borrow',
        params: { coinType, amount, protocol: 'alphalend', marketId },
      };
      return intent;
    }
    case 'withdraw': {
      const intent: WithdrawIntent = {
        ...base,
        action: 'withdraw',
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
    case 'repay': {
      const intent: RepayIntent = {
        ...base,
        action: 'repay',
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
        oracle,
        policyRegistry,
        tradeLog,
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
          action: 'claim_rewards',
          walletAddress: wallet.address,
          params: { protocol: 'alphalend' },
        };

        const policyCtx: PolicyContext = {
          config: chainConfig,
          oracle,
          tradeLog,
        };

        const signer = watchOnly ? undefined : buildSuiSigner(loadSessionKeyBytes(chainId));

        const builder = actionBuilderRegistry.getDefault(
          chain,
          'claim_rewards',
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
        });

        const output = mapLendingResultToOutput(result, intent, 'claim_rewards', undefined);
        printJsonOutput(output.cliOutput);
        process.exitCode = output.exitCode;
      } catch (err: unknown) {
        log.error({ err: toErrorMessage(err) }, 'Claim rewards failed');
        const errorOutput: ErrorResponse = {
          status: 'error',
          message: toErrorMessage(err),
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
        printJsonOutput({
          status: 'success',
          action: 'markets',
          data: markets,
        } as unknown as CliOutput);
      } catch (err: unknown) {
        log.error({ err: toErrorMessage(err) }, 'Failed to fetch markets');
        const errorOutput: ErrorResponse = {
          status: 'error',
          message: toErrorMessage(err),
        };
        printJsonOutput(errorOutput);
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

      const { alphalendClient, logger } = components;
      const log = logger.child({ command: 'lend-market' });

      try {
        const coinType = resolveTokenAddress(token.toUpperCase());
        const detail = await fetchMarketDetail(alphalendClient, coinType);
        printJsonOutput({
          status: 'success',
          action: 'market',
          data: detail,
        } as unknown as CliOutput);
      } catch (err: unknown) {
        log.error({ err: toErrorMessage(err) }, 'Failed to fetch market detail');
        const errorOutput: ErrorResponse = {
          status: 'error',
          message: toErrorMessage(err),
        };
        printJsonOutput(errorOutput);
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
        printJsonOutput({
          status: 'success',
          action: 'portfolio',
          data: portfolio,
        } as unknown as CliOutput);
      } catch (err: unknown) {
        log.error({ err: toErrorMessage(err) }, 'Failed to fetch portfolio');
        const errorOutput: ErrorResponse = {
          status: 'error',
          message: toErrorMessage(err),
        };
        printJsonOutput(errorOutput);
        process.exitCode = 1;
      }
    });
}

// --- Result mapping ---

/**
 * Result of mapping a PipelineResult to CLI output.
 */
interface MappedOutput {
  readonly cliOutput: CliOutput;
  readonly exitCode: number;
}

/**
 * Map a PipelineResult to a CliOutput and process exit code for lending actions.
 */
function mapLendingResultToOutput(
  result: PipelineResult,
  intent: TokenLendingIntent | ClaimRewardsIntent,
  action: string,
  tradeValueUsd: number | undefined,
): MappedOutput {
  const tokenInfo =
    intent.action !== 'claim_rewards'
      ? {
          token: intent.params.coinType,
          amount: intent.params.amount,
          marketId: intent.params.marketId,
        }
      : {};

  switch (result.status) {
    case 'success': {
      const output: LendingSuccessResponse = {
        status: 'success',
        chain: intent.chainId,
        action,
        txDigest: result.txDigest ?? '',
        protocol: 'alphalend',
        ...tokenInfo,
        valueUsd: tradeValueUsd ?? null,
        gasCost: result.gasUsed ?? 0,
      };
      return { cliOutput: output, exitCode: 0 };
    }

    case 'simulated': {
      const output: LendingSimulatedResponse = {
        status: 'simulated',
        chain: intent.chainId,
        action,
        protocol: 'alphalend',
        ...tokenInfo,
        gasEstimate: result.gasUsed ?? 0,
      };
      return { cliOutput: output, exitCode: 0 };
    }

    case 'rejected': {
      const output: RejectionResponse = {
        status: 'rejected',
        chain: intent.chainId,
        action,
        check: result.rejectionCheck ?? 'unknown',
        reason: result.rejectionReason ?? 'policy_rejected',
        detail: result.rejectionReason ?? 'Action rejected by policy engine',
      };
      return { cliOutput: output, exitCode: 3 };
    }

    case 'simulation_failed': {
      const output: ErrorResponse = {
        status: 'error',
        message: `Simulation failed: ${result.error ?? 'unknown error'}`,
      };
      return { cliOutput: output, exitCode: 4 };
    }

    case 'error': {
      const output: ErrorResponse = {
        status: 'error',
        message: result.error ?? 'Unknown pipeline error',
      };
      return { cliOutput: output, exitCode: 1 };
    }
  }
}
