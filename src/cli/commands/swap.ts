import type { Command } from 'commander';
import type { Chain, ChainId, SwapIntent } from '../../core/action-types.js';
import { createActionExecutor, type ExecutionResult } from '../../core/action-executor.js';
import { captureException } from '../../telemetry/index.js';
import type { AppComponents } from '../bootstrap.js';
import type { CliOutput, MappedOutput, SwapOutput } from '../output.js';
import { EXIT_CODES, handleCommandError, printJsonOutput } from '../output.js';

/**
 * Register the `fence swap` command on the given program.
 *
 * The command is a thin shell: parse args → build raw intent →
 * delegate to ActionExecutor → map result to CLI output.
 *
 * Execution mode (in-process vs daemon) is handled transparently
 * by the executor — this command has zero awareness of it.
 */
export function registerSwapCommand(program: Command, getComponents: () => AppComponents): void {
  program
    .command('swap <fromToken> <toToken> <amount>')
    .description('Execute a swap with policy enforcement')
    .option('-s, --slippage <percent>', 'Slippage tolerance in percent', '0.5')
    .option('-c, --chain <chain>', 'Target chain')
    .option('-o, --output <format>', 'Output format (json)', 'json')
    .action(
      async (
        fromToken: string,
        toToken: string,
        amountStr: string,
        options: {
          slippage: string;
          chain?: Chain;
          output: string;
        },
      ) => {
        const components = getComponents();
        const chain: Chain = options.chain ?? Object.keys(components.config.chain)[0] ?? 'sui';
        const chainId: ChainId = components.chainRegistry.get(chain).defaultChainId;
        const slippageBps = Math.round(parseFloat(options.slippage) * 100);

        try {
          const executor = createActionExecutor(getComponents);
          const rawIntent: SwapIntent = {
            chainId,
            action: 'trade:swap',
            walletAddress: '',
            params: {
              coinTypeIn: fromToken,
              coinTypeOut: toToken,
              amountIn: amountStr,
              slippageBps,
            },
          };
          const result = await executor.execute(rawIntent);

          const output = mapPipelineResultToOutput(result);
          printJsonOutput(output.cliOutput);
          process.exitCode = output.exitCode;
        } catch (err: unknown) {
          handleCommandError(err, 'trade:swap', chainId, captureException);
        }
      },
    );
}

/**
 * Map an ExecutionResult to a CliOutput and process exit code.
 */
function mapPipelineResultToOutput(execResult: ExecutionResult): MappedOutput {
  const { pipelineResult: result, resolvedIntent, walletAddress, tradeValueUsd } = execResult;
  const intent = resolvedIntent as SwapIntent;
  const meta = result.metadata;

  const base: CliOutput<SwapOutput> = {
    status: result.status,
    action: intent.action,
    chainId: intent.chainId,
    address: walletAddress,
    gasUsed: result.gasUsed,
    txDigest: result.txDigest,
    error: result.error,
    rejectionCheck: result.rejectionCheck,
    rejectionReason: result.rejectionReason,
  };

  const hasPayload = result.status === 'success' || result.status === 'simulated';
  const payload: SwapOutput | undefined = hasPayload
    ? {
        fromToken: intent.params.coinTypeIn,
        toToken: intent.params.coinTypeOut,
        amountIn: parseFloat(intent.params.amountIn),
        amountOut: parseFloat((meta?.['expectedOutput'] as string | undefined) ?? '0'),
        valueUsd: tradeValueUsd ?? null,
      }
    : undefined;

  return {
    cliOutput: { ...base, ...(payload !== undefined ? { payload } : {}) },
    exitCode: EXIT_CODES[result.status],
  };
}
