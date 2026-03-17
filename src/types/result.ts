/**
 * Result status from a policy check evaluation.
 */
export type CheckStatus = 'pass' | 'reject';

/**
 * Result returned by a single PolicyCheck evaluation.
 */
export interface CheckResult {
  /** Whether the check passed or rejected the intent */
  readonly status: CheckStatus;

  /** Machine-readable reason code (e.g., "token_not_allowed") */
  readonly reason?: string;

  /** Human-readable detail message */
  readonly detail?: string;

  /** Additional structured data for logging/debugging */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Result of a transaction simulation (dry-run).
 */
export interface SimulationResult {
  readonly success: boolean;
  readonly gasEstimate: number;
  readonly error?: string;
}

/**
 * Result of a submitted and confirmed transaction.
 */
export interface TxResult {
  readonly txDigest: string;
  readonly status: 'success' | 'failure';
  readonly gasUsed: number;
  readonly amountOut?: bigint;
}

/**
 * Balance information for a wallet address.
 */
export interface BalanceResult {
  readonly address: string;
  readonly balances: readonly TokenBalance[];
}

/**
 * Balance of a single token.
 */
export interface TokenBalance {
  readonly token: string;
  readonly amount: bigint;
  readonly decimals: number;
}

/**
 * Signer abstraction for signing transactions.
 */
export interface Signer {
  readonly address: string;
  readonly publicKey: Uint8Array;
  sign(data: Uint8Array): Promise<Uint8Array>;
}
