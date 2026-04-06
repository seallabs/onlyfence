import { BN } from '@coral-xyz/anchor';
import type { Program } from '@coral-xyz/anchor';
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { Connection, Keypair, TransactionInstruction } from '@solana/web3.js';
import {
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
} from '@solana/spl-token';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { PerpCancelOrderIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { Perpetuals } from '../perps/jupiter-perpetuals-idl.js';
import {
  CUSTODY_DETAILS,
  JLP_POOL_ACCOUNT_PUBKEY,
  MARKET_TO_CUSTODY,
  USDC_CUSTODY,
} from '../perps/constants.js';
import { generatePositionPda, generatePositionRequestPda, PERPETUALS_PDA } from '../perps/pda.js';
import {
  pollKeeperResult,
  PERP_COMPUTE_UNIT_PRICE,
  PERP_COMPUTE_UNIT_LIMIT,
} from '../perps/keeper.js';

/**
 * Jupiter Perpetuals close position (decrease) builder for Solana.
 *
 * Uses `createDecreasePositionMarketRequest` to close an entire position.
 */
export class SolanaPerpCancelOrderBuilder implements ActionBuilder<PerpCancelOrderIntent> {
  readonly builderId = 'jupiter-perp-cancel-order';
  readonly chain = 'solana';
  readonly executionStrategy = 'off-chain-signed' as const;

  constructor(
    private readonly program: Program<Perpetuals>,
    private readonly connection: Connection,
    private readonly getKeypair: () => Keypair,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: PerpCancelOrderIntent): void {
    if (intent.params.marketSymbol === '') {
      throw new Error('marketSymbol is required');
    }
  }

  build(_intent: PerpCancelOrderIntent): Promise<BuiltTransaction> {
    return Promise.resolve({ transaction: null, metadata: {} });
  }

  async execute(intent: PerpCancelOrderIntent): Promise<{ metadata: Record<string, unknown> }> {
    const keypair = this.getKeypair();
    const owner = keypair.publicKey;
    const baseAsset = intent.params.marketSymbol.split('-')[0] ?? '';

    const custodyKey = MARKET_TO_CUSTODY[baseAsset];
    if (custodyKey === undefined) {
      throw new Error(`Unknown market base asset: ${baseAsset}`);
    }
    const custodyPubkey = new PublicKey(custodyKey);
    const custodyDetail = CUSTODY_DETAILS[custodyKey];
    if (custodyDetail === undefined) {
      throw new Error(`Missing custody details for ${baseAsset}`);
    }

    const collateralCustodyPubkey = new PublicKey(USDC_CUSTODY);
    const desiredMint = custodyDetail.mint;

    // Find existing position (try short first, then long)
    const { position: positionPubkey } = generatePositionPda({
      custody: custodyPubkey,
      collateralCustody: collateralCustodyPubkey,
      walletAddress: owner,
      side: 'short',
    });

    // Try both sides in parallel — one will have the open position
    const { position: longPubkey } = generatePositionPda({
      custody: custodyPubkey,
      collateralCustody: custodyPubkey,
      walletAddress: owner,
      side: 'long',
    });

    const [shortResult, longResult] = await Promise.allSettled([
      this.program.account.position.fetch(positionPubkey),
      this.program.account.position.fetch(longPubkey),
    ]);

    let position;
    let resolvedPositionPubkey: PublicKey;

    if (shortResult.status === 'fulfilled' && shortResult.value.sizeUsd.gtn(0)) {
      position = shortResult.value;
      resolvedPositionPubkey = positionPubkey;
    } else if (longResult.status === 'fulfilled' && longResult.value.sizeUsd.gtn(0)) {
      position = longResult.value;
      resolvedPositionPubkey = longPubkey;
    } else {
      throw new Error(
        `No open position found for ${baseAsset}. ` +
          `Short: ${shortResult.status === 'rejected' ? String(shortResult.reason) : 'closed'}. ` +
          `Long: ${longResult.status === 'rejected' ? String(longResult.reason) : 'closed'}.`,
      );
    }

    const { positionRequest, counter } = generatePositionRequestPda({
      positionPubkey: resolvedPositionPubkey,
      requestChange: 'decrease',
    });

    const receivingAccount = getAssociatedTokenAddressSync(desiredMint, owner, true);
    const postInstructions: TransactionInstruction[] = [];

    if (desiredMint.equals(NATIVE_MINT)) {
      postInstructions.push(createCloseAccountInstruction(receivingAccount, owner, owner));
    }

    const decreaseIx = await this.program.methods
      .createDecreasePositionMarketRequest({
        collateralUsdDelta: new BN(0),
        sizeUsdDelta: new BN(0),
        priceSlippage: new BN(100_000_000_000),
        jupiterMinimumOut: null,
        counter,
        entirePosition: true,
      })
      .accounts({
        owner,
        receivingAccount,
        perpetuals: PERPETUALS_PDA,
        pool: JLP_POOL_ACCOUNT_PUBKEY,
        position: resolvedPositionPubkey,
        positionRequest,
        positionRequestAta: getAssociatedTokenAddressSync(desiredMint, positionRequest, true),
        custody: position.custody,
        collateralCustody: position.collateralCustody,
        desiredMint,
        referral: null,
      })
      .instruction();

    const instructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PERP_COMPUTE_UNIT_PRICE }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: PERP_COMPUTE_UNIT_LIMIT }),
      decreaseIx,
      ...postInstructions,
    ];

    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    const txMessage = new TransactionMessage({
      payerKey: owner,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(txMessage);
    tx.sign([keypair]);

    const txSignature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    const { status, executionTxId } = await pollKeeperResult(this.connection, positionRequest);

    return {
      metadata: {
        txDigest: executionTxId ?? txSignature,
        requestSignature: txSignature,
        positionRequest: positionRequest.toBase58(),
        status,
      },
    };
  }

  finish(context: FinishContext): void {
    try {
      const intent = context.intent as PerpCancelOrderIntent;
      this.activityLog.logActivity({
        chain_id: intent.chainId,
        wallet_address: intent.walletAddress,
        action: 'perp:cancel_order',
        protocol: 'jupiter_perps',
        tx_digest: context.txDigest ?? undefined,
        gas_cost: context.gasUsed ?? undefined,
        policy_decision: context.status,
        rejection_reason: context.rejection?.reason ?? undefined,
        rejection_check: context.rejection?.check ?? undefined,
        metadata: { marketSymbol: intent.params.marketSymbol },
      });
    } catch {
      // Activity logging should never fail the pipeline
    }
  }
}
