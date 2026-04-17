import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Keypair, type PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import { IDL } from './jupiter-perpetuals-idl.js';
import type { Perpetuals } from './jupiter-perpetuals-idl.js';
import {
  CUSTODY_DETAILS,
  JUPITER_PERPETUALS_PROGRAM_ID,
  JLP_POOL_ACCOUNT_PUBKEY,
} from './constants.js';

/**
 * Create the Jupiter Perpetuals Anchor program instance.
 *
 * Uses a dummy wallet for read-only operations. For signing,
 * the actual keypair is injected at the transaction level.
 */
export function createPerpetualsProgram(connection: Connection): Program<Perpetuals> {
  const provider = new AnchorProvider(
    connection,
    new Wallet(Keypair.generate()),
    AnchorProvider.defaultOptions(),
  );
  return new Program<Perpetuals>(IDL, JUPITER_PERPETUALS_PROGRAM_ID, provider);
}

/**
 * Get custody remaining accounts (oracle accounts) required by perp instructions.
 *
 * These are passed as `remainingAccounts` to perp instructions.
 * Order: custodies, then dovesAgOracles, then pythnetOracles.
 */
export async function getCustodyRemainingAccounts(
  program: Program<Perpetuals>,
): Promise<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]> {
  const pool = await program.account.pool.fetch(JLP_POOL_ACCOUNT_PUBKEY);

  const metas: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];

  // First pass: custody accounts
  for (const custody of pool.custodies) {
    metas.push({ isSigner: false, isWritable: false, pubkey: custody });
  }

  // Second pass: dovesAg oracle accounts
  for (const custody of pool.custodies) {
    const details = CUSTODY_DETAILS[custody.toString()];
    if (details !== undefined) {
      metas.push({ isSigner: false, isWritable: false, pubkey: details.dovesAgOracle });
    }
  }

  // Third pass: pythnet oracle accounts
  for (const custody of pool.custodies) {
    const details = CUSTODY_DETAILS[custody.toString()];
    if (details !== undefined) {
      metas.push({ isSigner: false, isWritable: false, pubkey: details.pythnetOracle });
    }
  }

  return metas;
}
