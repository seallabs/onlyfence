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
 *
 * Generic parameter `T` carries the chain-specific raw RPC response
 * (e.g., `DryRunTransactionBlockResponse` on Sui). The pipeline can
 * pass this to chain-specific event parsers without knowing the shape.
 */
export interface SimulationResult<T = unknown> {
  readonly success: boolean;
  readonly gasEstimate: number;
  readonly error?: string;
  readonly rawResponse: T;
}

/**
 * Result of a submitted and confirmed transaction.
 *
 * Generic parameter `T` carries the chain-specific raw RPC response
 * (e.g., `SuiTransactionBlockResponse` on Sui).
 */
export interface TxResult<T = unknown> {
  readonly txDigest: string;
  readonly status: 'success' | 'failure';
  readonly gasUsed: number;
  readonly rawResponse: T;
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
