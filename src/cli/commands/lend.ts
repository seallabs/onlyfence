import type { Command } from 'commander';
import {
  fetchAllMarkets,
  fetchMarketDetail,
  fetchPortfolio,
} from '../../chain/sui/alphalend/markets.js';
import type {
  ActionIntent,
  BorrowIntent,
  ChainId,
  ClaimRewardsIntent,
  LendingAction,
  RepayIntent,
  SupplyIntent,
  TokenLendingIntent,
  WithdrawIntent,
} from '../../core/action-types.js';
import { createActionExecutor, type ExecutionResult } from '../../core/action-executor.js';
import { captureException } from '../../telemetry/index.js';
import { toErrorMessage } from '../../utils/index.js';
import { getPrimaryWallet } from '../../wallet/manager.js';
import type { SuiChainModule } from '../../chain/sui/module.js';
import type { AppComponents } from '../bootstrap.js';
import type { CliOutput, LendingOutput, LendingRewardsOutput, MappedOutput } from '../output.js';
import { EXIT_CODES, handleCommandError, printJsonOutput } from '../output.js';
import { resolveChainId, resolveDefaultChain } from '../resolve-chain.js';
import { withComponents } from '../with-components.js';

/**
 * Register the `fence lend` command group on the given program.
 *
 * Transactional subcommands are thin shells: parse args → build raw intent →
 * delegate to ActionExecutor → map result to CLI output.
 *
 * Execution mode (in-process vs daemon) is handled transparently
 * by the executor — commands have zero awareness of it.
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
 * All share the same flow: build raw intent → executor → output.
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
    .option('-c, --chain <chain>', 'Target chain')
    .option('-o, --output <format>', 'Output format (json)', 'json')
    .action(
      async (
        token: string,
        amountStr: string,
        options: { market?: string; chain?: string; output: string },
      ) => {
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
    .option('-c, --chain <chain>', 'Target chain')
    .option('-o, --output <format>', 'Output format (json)', 'json')
    .option('-a, --all', 'Withdraw entire position')
    .action(
      async (
        token: string,
        amountStr: string,
        options: { market?: string; chain?: string; output: string; all?: boolean },
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
 *
 * Builds a raw intent with user-provided inputs and delegates to the
 * ActionExecutor. Resolution (tokens, markets, prices) happens inside
 * the executor — this function has zero awareness of execution mode.
 */
async function executeTokenLendingAction(
  action: LendingAction,
  token: string,
  amountStr: string,
  options: { market?: string; chain?: string; all?: boolean },
  getComponents: () => AppComponents,
): Promise<void> {
  const components = getComponents();
  const chain = options.chain ?? resolveDefaultChain(components.config);
  const chainId = resolveChainId(chain, components.chainAdapterFactory);

  try {
    const executor = createActionExecutor(getComponents);

    // Build raw intent with user-provided values — the executor's resolver
    // will transform symbols → coin types, scale amounts, resolve market IDs.
    const rawIntent = buildRawTokenIntent(action, chainId, token, amountStr, options);
    const result = await executor.execute(rawIntent);

    const output = mapLendingResultToOutput(result, action);
    printJsonOutput(output.cliOutput);
    process.exitCode = output.exitCode;
  } catch (err: unknown) {
    handleCommandError(err, action, chainId, captureException);
  }
}

/**
 * Build a raw (unresolved) intent for a token-based lending action.
 * Fields like coinType, amount, and marketId contain user-provided values
 * that the IntentResolver will resolve before pipeline execution.
 */
function buildRawTokenIntent(
  action: LendingAction,
  chainId: ChainId,
  token: string,
  amount: string,
  options: { market?: string; all?: boolean },
): ActionIntent {
  const base = { chainId, walletAddress: '' } as const;

  switch (action) {
    case 'lending:supply': {
      const intent: SupplyIntent = {
        ...base,
        action: 'lending:supply',
        params: { coinType: token, amount, protocol: 'alphalend', marketId: options.market ?? '' },
      };
      return intent;
    }
    case 'lending:borrow': {
      const intent: BorrowIntent = {
        ...base,
        action: 'lending:borrow',
        params: { coinType: token, amount, protocol: 'alphalend', marketId: options.market ?? '' },
      };
      return intent;
    }
    case 'lending:withdraw': {
      const intent: WithdrawIntent = {
        ...base,
        action: 'lending:withdraw',
        params: {
          coinType: token,
          amount,
          protocol: 'alphalend',
          marketId: options.market ?? '',
          ...(options.all === true ? { withdrawAll: true } : {}),
        },
      };
      return intent;
    }
    case 'lending:repay': {
      const intent: RepayIntent = {
        ...base,
        action: 'lending:repay',
        params: { coinType: token, amount, protocol: 'alphalend', marketId: options.market ?? '' },
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
    .option('-c, --chain <chain>', 'Target chain')
    .option('-o, --output <format>', 'Output format (json)', 'json')
    .action(async (options: { chain?: string; output: string }) => {
      const components = getComponents();
      const chain = options.chain ?? resolveDefaultChain(components.config);
      const chainId = resolveChainId(chain, components.chainAdapterFactory);

      try {
        const executor = createActionExecutor(getComponents);

        const rawIntent: ClaimRewardsIntent = {
          chainId,
          action: 'lending:claim_rewards',
          walletAddress: '',
          params: { protocol: 'alphalend' },
        };

        const result = await executor.execute(rawIntent);
        const output = mapLendingResultToOutput(result, 'lending:claim_rewards');
        printJsonOutput(output.cliOutput);
        process.exitCode = output.exitCode;
      } catch (err: unknown) {
        handleCommandError(err, 'lending:claim_rewards', chainId, captureException);
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

      const { chainModules, logger } = components;
      const log = logger.child({ command: 'lend-markets' });

      try {
        const suiModule = chainModules.get('sui') as SuiChainModule;
        if (suiModule.alphalendClient === undefined) {
          throw new Error('AlphaLend client not initialized. Ensure Sui chain is configured.');
        }
        const markets = await fetchAllMarkets(suiModule.alphalendClient);
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
    .option('-c, --chain <chain>', 'Target chain')
    .action(async (token: string, options: { chain?: string }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const { chainModules, chainAdapterFactory, logger, config } = components;
      const chain = options.chain ?? resolveDefaultChain(config);
      const log = logger.child({ command: 'lend-market' });

      try {
        const suiModule = chainModules.get('sui') as SuiChainModule;
        if (suiModule.alphalendClient === undefined) {
          throw new Error('AlphaLend client not initialized. Ensure Sui chain is configured.');
        }
        const chainAdapter = chainAdapterFactory.get(chain);
        const coinType = chainAdapter.resolveTokenAddress(token);
        const detail = await fetchMarketDetail(suiModule.alphalendClient, coinType);
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
    .option('-c, --chain <chain>', 'Target chain')
    .action(async (options: { chain?: string }) => {
      const components = withComponents(getComponents);
      if (components === undefined) return;

      const { db, chainModules, chainAdapterFactory, logger, config } = components;
      const chain = options.chain ?? resolveDefaultChain(config);
      const chainId = resolveChainId(chain, chainAdapterFactory);
      const log = logger.child({ command: 'lend-portfolio' });

      try {
        const suiModule = chainModules.get('sui') as SuiChainModule;
        if (suiModule.alphalendClient === undefined) {
          throw new Error('AlphaLend client not initialized. Ensure Sui chain is configured.');
        }
        const wallet = getPrimaryWallet(db, chainId);
        if (wallet === null) {
          throw new Error(
            `No primary wallet found for chain "${chainId}". Run "fence setup" first.`,
          );
        }

        const portfolio = await fetchPortfolio(suiModule.alphalendClient, wallet.address);
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
 * Map an ExecutionResult to a CliOutput and process exit code for lending actions.
 */
function mapLendingResultToOutput(
  execResult: ExecutionResult,
  action: LendingAction | 'lending:claim_rewards',
): MappedOutput<LendingPayload> {
  const {
    pipelineResult: result,
    resolvedIntent: intent,
    walletAddress,
    tradeValueUsd,
  } = execResult;

  const base: CliOutput<LendingPayload> = {
    status: result.status,
    action,
    chainId: intent.chainId,
    address: walletAddress,
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
    const tokenIntent = intent as TokenLendingIntent;
    payload = {
      token: tokenIntent.params.coinType,
      amount: parseFloat(tokenIntent.params.amount),
      marketId: tokenIntent.params.marketId,
      valueUsd: tradeValueUsd ?? null,
    };
  }

  return {
    cliOutput: { ...base, ...(payload !== undefined ? { payload } : {}) },
    exitCode: EXIT_CODES[result.status],
  };
}
