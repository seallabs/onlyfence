import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { BalanceResult, Signer, SimulationResult, TxResult } from '../../types/result.js';
import type { ChainAdapter } from '../adapter.js';
import { getKnownDecimals, resolveTokenAddress, resolveSymbol } from './tokens.js';

/** Native SOL mint address (wrapped SOL). */
const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** Default decimals for SOL. */
const SOL_DECIMALS = 9;

/** CAIP-2 chain identifier for Solana mainnet. */
export const SOLANA_CHAIN_ID = 'solana:mainnet' as const;

/**
 * Solana blockchain adapter implementing the ChainAdapter interface.
 *
 * Uses `@solana/web3.js` Connection for balance queries,
 * transaction simulation, and transaction submission.
 */
export class SolanaAdapter implements ChainAdapter {
  readonly chain = 'solana' as const;
  readonly chainId = SOLANA_CHAIN_ID;

  constructor(readonly connection: Connection) {}

  resolveTokenAddress(symbolOrAddress: string): string {
    return resolveTokenAddress(symbolOrAddress);
  }

  resolveTokenSymbol(mintAddress: string): string {
    return resolveSymbol(mintAddress);
  }

  async getBalance(address: string): Promise<BalanceResult> {
    const pubkey = new PublicKey(address);

    // Fetch SOL balance and SPL token balances in parallel
    const [lamports, tokenAccounts] = await Promise.all([
      this.connection.getBalance(pubkey),
      this.connection.getParsedTokenAccountsByOwner(pubkey, {
        programId: TOKEN_PROGRAM_ID,
      }),
    ]);

    const balances: { token: string; amount: bigint; decimals: number }[] = [];

    // Native SOL
    balances.push({
      token: resolveSymbol(SOL_MINT),
      amount: BigInt(lamports),
      decimals: SOL_DECIMALS,
    });

    // SPL tokens
    for (const { account } of tokenAccounts.value) {
      const parsed = account.data.parsed as {
        info: { mint: string; tokenAmount: { amount: string; decimals: number } };
      };
      const { mint, tokenAmount } = parsed.info;
      const amount = BigInt(tokenAmount.amount);
      if (amount === 0n) continue;

      const decimals = getKnownDecimals(mint) ?? tokenAmount.decimals;
      balances.push({
        token: resolveSymbol(mint),
        amount,
        decimals,
      });
    }

    return { address, balances };
  }

  buildTransactionBytes(transaction: VersionedTransaction): Promise<Uint8Array> {
    return Promise.resolve(transaction.serialize());
  }

  async simulate(txBytes: Uint8Array, _sender?: string): Promise<SimulationResult> {
    const tx = VersionedTransaction.deserialize(txBytes);
    const result = await this.connection.simulateTransaction(tx, {
      sigVerify: false,
    });

    if (result.value.err === null) {
      return {
        success: true,
        gasEstimate: result.value.unitsConsumed ?? 0,
        rawResponse: result,
      };
    }

    return {
      success: false,
      gasEstimate: result.value.unitsConsumed ?? 0,
      error: JSON.stringify(result.value.err),
      rawResponse: result,
    };
  }

  async signAndSubmit(txBytes: Uint8Array, signer: Signer): Promise<TxResult> {
    const { bytes } = await signer.signTransaction(txBytes);
    const signedTxBytes = Buffer.from(bytes, 'base64');

    const txSignature = await this.connection.sendRawTransaction(signedTxBytes, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    // Confirm the transaction
    const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
    const confirmation = await this.connection.confirmTransaction(
      {
        signature: txSignature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      'confirmed',
    );

    const hasError = confirmation.value.err !== null;

    return {
      txDigest: txSignature,
      status: hasError ? 'failure' : 'success',
      gasUsed: 0, // Solana doesn't report gas in the same way
      rawResponse: confirmation,
    };
  }
}
