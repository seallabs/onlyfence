/**
 * JSON output types per spec section 13.
 *
 * These interfaces define the structured output returned by CLI commands,
 * ensuring consistent machine-readable responses for agent consumers.
 */

/**
 * Successful trade execution response.
 */
export interface SuccessResponse {
  readonly status: 'success';
  readonly chain: string;
  readonly action: string;
  readonly txDigest: string;
  readonly fromToken: string;
  readonly toToken: string;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly valueUsd: number | null;
  readonly gasCost: number;
  readonly route: string;
}

/**
 * Policy rejection response.
 */
export interface RejectionResponse {
  readonly status: 'rejected';
  readonly chain: string;
  readonly action: string;
  readonly check: string;
  readonly reason: string;
  readonly detail: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Error response for unexpected failures.
 */
export interface ErrorResponse {
  readonly status: 'error';
  readonly message: string;
}

/**
 * Simulated trade response (watch-only mode).
 */
export interface SimulatedResponse {
  readonly status: 'simulated';
  readonly chain: string;
  readonly action: string;
  readonly fromToken: string;
  readonly toToken: string;
  readonly amountIn: string;
  readonly expectedOutput: string;
  readonly provider: string;
  readonly priceImpact?: number;
  readonly gasEstimate: number;
}

/**
 * Union of all CLI output types.
 */
export type CliOutput = SuccessResponse | RejectionResponse | ErrorResponse | SimulatedResponse;

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
