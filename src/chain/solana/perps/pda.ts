import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { JLP_POOL_ACCOUNT_PUBKEY, JUPITER_PERPETUALS_PROGRAM_ID } from './constants.js';

/**
 * Generate a PositionRequest PDA.
 *
 * The positionRequest PDA holds requests for all perpetuals actions.
 * Once submitted on-chain, keepers pick them up and execute.
 */
export function generatePositionRequestPda({
  counter,
  positionPubkey,
  requestChange,
}: {
  counter?: BN;
  positionPubkey: PublicKey;
  requestChange: 'increase' | 'decrease';
}): { positionRequest: PublicKey; counter: BN; bump: number } {
  const resolvedCounter = counter ?? new BN(Math.floor(Math.random() * 1_000_000_000));
  const requestChangeEnum = requestChange === 'increase' ? [1] : [2];

  const [positionRequest, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('position_request'),
      new PublicKey(positionPubkey).toBuffer(),
      resolvedCounter.toArrayLike(Buffer, 'le', 8),
      Buffer.from(requestChangeEnum),
    ],
    JUPITER_PERPETUALS_PROGRAM_ID,
  );

  return { positionRequest, counter: resolvedCounter, bump };
}

/**
 * Generate a Position PDA for a trader's position.
 *
 * The Position PDA stores position data (both open and closed).
 */
export function generatePositionPda({
  custody,
  collateralCustody,
  walletAddress,
  side,
}: {
  custody: PublicKey;
  collateralCustody: PublicKey;
  walletAddress: PublicKey;
  side: 'long' | 'short';
}): { position: PublicKey; bump: number } {
  const sideEnum = side === 'long' ? [1] : [2];

  const [position, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('position'),
      walletAddress.toBuffer(),
      JLP_POOL_ACCOUNT_PUBKEY.toBuffer(),
      custody.toBuffer(),
      collateralCustody.toBuffer(),
      Buffer.from(sideEnum),
    ],
    JUPITER_PERPETUALS_PROGRAM_ID,
  );

  return { position, bump };
}

/** Perpetuals global state PDA (deterministic constant). */
export const PERPETUALS_PDA: PublicKey = PublicKey.findProgramAddressSync(
  [Buffer.from('perpetuals')],
  JUPITER_PERPETUALS_PROGRAM_ID,
)[0];
