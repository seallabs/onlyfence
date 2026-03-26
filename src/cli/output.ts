/**
 * JSON output types per spec section 13.
 *
 * These interfaces define the structured output returned by CLI commands,
 * ensuring consistent machine-readable responses for agent consumers.
 */

import type {
  ActivityAction,
  ChainId,
  DefiProtocol,
  PipelineStatus,
} from '../core/action-types.js';
import { toErrorMessage } from '../utils/index.js';

/** Map of reward token to amount value */
type RewardMap = Record<
  string,
  {
    /** Unit: human readable */
    amount: number;
    valueUsd?: number | null;
  }
>;

export interface SwapOutput {
  readonly fromToken: string;
  readonly toToken: string;
  /** Unit: human readable */
  readonly amountIn: number;
  /** Unit: human readable */
  readonly amountOut: number;
  readonly valueUsd: number | null;
}

export interface LendingOutput {
  readonly token: string;
  /** Unit: human readable */
  readonly amount: number;
  readonly marketId: string;
  readonly valueUsd?: number | null;
}

export interface LendingRewardsOutput {
  /** total rewards in USD; */
  readonly valueUsd?: number | null;
  /** rewards by token */
  readonly rewards?: RewardMap;
}

export interface LPOutput {
  readonly base: string;
  readonly quote: string;
  /** Unit: human readable */
  readonly amountBase: number;
  /** Unit: human readable */
  readonly amountQuote: number;
  /** Unit: human readable */
  readonly valueUsd?: number | null;
  readonly rewards?: RewardMap;
}

export interface PerpOrderOutput {
  readonly marketSymbol: string;
  readonly side: string;
  readonly orderType: string;
  readonly quantityE9: string;
  readonly priceE9?: string;
  readonly leverageE9: string;
  readonly orderHash?: string;
}

export interface PerpDepositOutput {
  readonly token: string;
  readonly amount: number;
  readonly valueUsd: number | null;
}

export interface PerpWithdrawOutput {
  readonly assetSymbol: string;
  readonly amountE9: string;
  readonly valueUsd: number | null;
}

export interface PerpCancelOutput {
  readonly marketSymbol: string;
  readonly cancelledCount: number;
}

/** Action payload union -- extend when adding new action output types */
export type ActionPayload =
  | SwapOutput
  | LendingOutput
  | LendingRewardsOutput
  | LPOutput
  | PerpOrderOutput
  | PerpDepositOutput
  | PerpWithdrawOutput
  | PerpCancelOutput;

/**
 * Unified CLI output for all pipeline-based commands.
 *
 * Generic parameter T narrows the payload to a specific action output type.
 */
export interface CliOutput<T extends ActionPayload = ActionPayload> {
  readonly status: PipelineStatus;
  readonly action: ActivityAction;
  readonly chainId: ChainId;
  readonly address: string;
  readonly gasUsed?: number | undefined;
  readonly txDigest?: string | undefined;
  readonly protocol?: DefiProtocol | undefined;
  readonly payload?: T | undefined;
  readonly error?: string | undefined;
  readonly rejectionCheck?: string | undefined;
  readonly rejectionReason?: string | undefined;
}

/** Exit codes by pipeline status */
export const EXIT_CODES: Record<PipelineStatus, number> = {
  success: 0,
  simulated: 0,
  rejected: 3,
  simulation_failed: 4,
  error: 1,
};

/**
 * Result of mapping a PipelineResult to CLI output.
 */
export interface MappedOutput<T extends ActionPayload = ActionPayload> {
  readonly cliOutput: CliOutput<T>;
  readonly exitCode: number;
}

/**
 * Format a CLI output object as a JSON string for stdout.
 *
 * @param output - The output object to format
 * @returns Pretty-printed JSON string
 */
export function formatJsonOutput(output: CliOutput): string {
  return JSON.stringify(output, null, 2);
}

/**
 * Print a CLI output object to stdout as JSON.
 *
 * @param output - The output object to print
 */
export function printJsonOutput(output: CliOutput): void {
  console.log(formatJsonOutput(output));
}

/**
 * Handle a command-level error by printing a structured JSON error
 * and setting the process exit code.
 */
export function handleCommandError(
  err: unknown,
  action: ActivityAction,
  chainId: ChainId,
  captureExceptionFn: (e: unknown) => void,
): void {
  captureExceptionFn(err);
  printJsonOutput({
    status: 'error',
    action,
    chainId,
    address: '',
    error: toErrorMessage(err),
  });
  process.exitCode = 1;
}
