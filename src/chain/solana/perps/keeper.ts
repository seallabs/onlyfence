import type { Connection, PublicKey } from '@solana/web3.js';

/** Default timeout for keeper execution polling. */
const KEEPER_TIMEOUT_MS = 30_000;
const KEEPER_POLL_INTERVAL_MS = 1_000;

/** Compute budget defaults for perp transactions. */
export const PERP_COMPUTE_UNIT_PRICE = 100_000;
export const PERP_COMPUTE_UNIT_LIMIT = 1_400_000;

export interface KeeperResult {
  readonly status: 'success' | 'pending';
  readonly executionTxId: string | undefined;
}

/**
 * Poll for keeper execution of a position request using @jup-ag/perpetuals-sdk.
 *
 * Returns success if the keeper executes within the timeout, pending otherwise.
 * Never throws — returns pending on any error.
 */
export async function pollKeeperResult(
  connection: Connection,
  positionRequest: PublicKey,
): Promise<KeeperResult> {
  try {
    const { Perpetual } = await import('@jup-ag/perpetuals-sdk');
    const perpetual = new Perpetual(connection);
    const result = await perpetual.checkPositionRequestUntilResult(
      positionRequest,
      KEEPER_TIMEOUT_MS,
      KEEPER_POLL_INTERVAL_MS,
    );
    if (result.success) {
      return { status: 'success', executionTxId: result.txSignature };
    }
    return { status: 'pending', executionTxId: undefined };
  } catch {
    return { status: 'pending', executionTxId: undefined };
  }
}
