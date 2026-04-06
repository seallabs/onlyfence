import { VersionedTransaction } from '@solana/web3.js';
import type { Keypair } from '@solana/web3.js';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { SwapIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { JupiterClient } from './client.js';

/**
 * Jupiter Swap V2 builder for Solana.
 *
 * Uses the off-chain-signed execution strategy:
 * 1. POST /swap/v2/order -> get pre-built transaction
 * 2. Sign the transaction
 * 3. POST /swap/v2/execute -> submit signed transaction
 *
 * The pipeline's on-chain flow (build -> simulate -> signAndSubmit) is bypassed;
 * everything happens in execute().
 */
export class SolanaSwapBuilder implements ActionBuilder<SwapIntent> {
  readonly builderId = 'jupiter-swap';
  readonly chain = 'solana';
  readonly executionStrategy = 'off-chain-signed' as const;

  constructor(
    private readonly jupiterClient: JupiterClient,
    private readonly getKeypair: () => Keypair,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: SwapIntent): void {
    const { coinTypeIn, coinTypeOut, amountIn } = intent.params;
    if (coinTypeIn === '' || coinTypeOut === '') {
      throw new Error('Missing token types');
    }
    if (amountIn === '' || BigInt(amountIn) <= 0n) {
      throw new Error('Invalid amount');
    }
    if (coinTypeIn === coinTypeOut) {
      throw new Error('Cannot swap token to itself');
    }
  }

  build(_intent: SwapIntent): Promise<BuiltTransaction> {
    // No-op: Jupiter builds the transaction via REST
    return Promise.resolve({ transaction: null, metadata: {} });
  }

  async execute(intent: SwapIntent): Promise<{ metadata: Record<string, unknown> }> {
    const { coinTypeIn, coinTypeOut, amountIn, slippageBps } = intent.params;
    const keypair = this.getKeypair();

    // 1. Get pre-built transaction from Jupiter
    const orderResponse = await this.jupiterClient.swapOrder({
      inputMint: coinTypeIn,
      outputMint: coinTypeOut,
      amount: amountIn,
      taker: keypair.publicKey.toBase58(),
      slippageBps,
    });

    // 2. Deserialize and sign the transaction
    const txBytes = Buffer.from(orderResponse.transaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([keypair]);

    // 3. Submit signed transaction
    const signedTxBase64 = Buffer.from(tx.serialize()).toString('base64');
    const executeResponse = await this.jupiterClient.swapExecute({
      signedTransaction: signedTxBase64,
      requestId: orderResponse.requestId,
    });

    return {
      metadata: {
        txDigest: executeResponse.signature,
        expectedOutput: orderResponse.outAmount,
        priceImpactPct: orderResponse.priceImpactPct,
        requestId: orderResponse.requestId,
      },
    };
  }

  finish(context: FinishContext): void {
    try {
      const intent = context.intent as SwapIntent;

      this.activityLog.logActivity({
        chain_id: intent.chainId,
        wallet_address: intent.walletAddress,
        action: 'trade:swap',
        protocol: 'jupiter_swap',
        token_a_type: intent.params.coinTypeIn,
        token_a_amount: intent.params.amountIn,
        token_b_type: intent.params.coinTypeOut,
        token_b_amount: (context.metadata?.['expectedOutput'] as string | undefined) ?? undefined,
        value_usd: intent.tradeValueUsd ?? undefined,
        tx_digest:
          context.txDigest ?? (context.metadata?.['txDigest'] as string | undefined) ?? undefined,
        gas_cost: context.gasUsed ?? undefined,
        policy_decision: context.status,
        rejection_reason: context.rejection?.reason ?? undefined,
        rejection_check: context.rejection?.check ?? undefined,
      });
    } catch {
      // Activity logging should never fail the pipeline
    }
  }
}
