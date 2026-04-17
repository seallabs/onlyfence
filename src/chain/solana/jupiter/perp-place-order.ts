import { BN } from '@coral-xyz/anchor';
import type { Program } from '@coral-xyz/anchor';
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { Connection, Keypair, TransactionInstruction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
} from '@solana/spl-token';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { PerpPlaceOrderIntent } from '../../../core/action-types.js';
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
 * Jupiter Perpetuals place order builder for Solana.
 *
 * Uses Anchor IDL to build `createIncreasePositionMarketRequest` instructions.
 * Jupiter Perps uses an async keeper model: submitting a position request creates
 * an on-chain request account that keepers execute within seconds.
 */
export class SolanaPerpPlaceOrderBuilder implements ActionBuilder<PerpPlaceOrderIntent> {
  readonly builderId = 'jupiter-perp-place-order';
  readonly chain = 'solana';
  readonly executionStrategy = 'off-chain-signed' as const;

  constructor(
    private readonly program: Program<Perpetuals>,
    private readonly connection: Connection,
    private readonly getKeypair: () => Keypair,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: PerpPlaceOrderIntent): void {
    if (intent.params.marketSymbol === '') {
      throw new Error('marketSymbol is required');
    }
    if (intent.params.quantityE9 === '0') {
      throw new Error('quantity must be greater than zero');
    }
    if (intent.params.orderType === 'LIMIT' && intent.params.limitPriceE9 === undefined) {
      throw new Error('limitPriceE9 is required for LIMIT orders');
    }
  }

  build(_intent: PerpPlaceOrderIntent): Promise<BuiltTransaction> {
    return Promise.resolve({ transaction: null, metadata: {} });
  }

  async execute(intent: PerpPlaceOrderIntent): Promise<{ metadata: Record<string, unknown> }> {
    const { params } = intent;
    const keypair = this.getKeypair();
    const owner = keypair.publicKey;

    // Resolve market -> custody
    const baseAsset = params.marketSymbol.split('-')[0] ?? '';
    const custodyKey = MARKET_TO_CUSTODY[baseAsset];
    if (custodyKey === undefined) {
      throw new Error(`Unknown market base asset: ${baseAsset}`);
    }
    const custodyPubkey = new PublicKey(custodyKey);
    const custodyDetail = CUSTODY_DETAILS[custodyKey];
    if (custodyDetail === undefined) {
      throw new Error(`Missing custody details for ${baseAsset}`);
    }

    // Determine collateral custody based on side
    const isLong = params.side === 'LONG';
    const collateralCustodyKey = isLong ? custodyKey : USDC_CUSTODY;
    const collateralCustodyPubkey = new PublicKey(collateralCustodyKey);
    const collateralDetail = CUSTODY_DETAILS[collateralCustodyKey];
    if (collateralDetail === undefined) {
      throw new Error(`Missing collateral custody details`);
    }
    const inputMint = collateralDetail.mint;

    // Generate position PDA
    const { position: positionPubkey } = generatePositionPda({
      custody: custodyPubkey,
      collateralCustody: collateralCustodyPubkey,
      walletAddress: owner,
      side: isLong ? 'long' : 'short',
    });

    // Generate position request PDA
    const { positionRequest, counter } = generatePositionRequestPda({
      positionPubkey,
      requestChange: 'increase',
    });

    const positionRequestAta = getAssociatedTokenAddressSync(inputMint, positionRequest, true);
    const fundingAccount = getAssociatedTokenAddressSync(inputMint, owner);

    const sizeUsdDelta = new BN(params.quantityE9);
    const collateralTokenDelta = new BN(params.quantityE9);
    const priceSlippage = new BN(100_000_000_000); // Large slippage for market orders

    const preInstructions: TransactionInstruction[] = [];
    const postInstructions: TransactionInstruction[] = [];

    // Wrap SOL if needed
    if (inputMint.equals(NATIVE_MINT)) {
      preInstructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          owner,
          fundingAccount,
          owner,
          NATIVE_MINT,
        ),
      );
      preInstructions.push(
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: fundingAccount,
          lamports: BigInt(collateralTokenDelta.toString()),
        }),
      );
      preInstructions.push(createSyncNativeInstruction(fundingAccount));
      postInstructions.push(createCloseAccountInstruction(fundingAccount, owner, owner));
    }

    const increaseIx = await this.program.methods
      .createIncreasePositionMarketRequest({
        counter,
        collateralTokenDelta,
        jupiterMinimumOut: null,
        priceSlippage,
        side: isLong ? { long: {} } : { short: {} },
        sizeUsdDelta,
      })
      .accounts({
        custody: custodyPubkey,
        collateralCustody: collateralCustodyPubkey,
        fundingAccount,
        inputMint,
        owner,
        perpetuals: PERPETUALS_PDA,
        pool: JLP_POOL_ACCOUNT_PUBKEY,
        position: positionPubkey,
        positionRequest,
        positionRequestAta,
        referral: null,
      })
      .instruction();

    const instructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PERP_COMPUTE_UNIT_PRICE }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: PERP_COMPUTE_UNIT_LIMIT }),
      ...preInstructions,
      increaseIx,
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
      const intent = context.intent as PerpPlaceOrderIntent;
      this.activityLog.logActivity({
        chain_id: intent.chainId,
        wallet_address: intent.walletAddress,
        action: 'perp:place_order',
        protocol: 'jupiter_perps',
        token_a_type: intent.params.collateralCoinType,
        token_a_amount: intent.params.quantityE9,
        token_b_type: intent.params.marketCoinType,
        value_usd: intent.valueUsd ?? undefined,
        tx_digest: context.txDigest ?? undefined,
        gas_cost: context.gasUsed ?? undefined,
        policy_decision: context.status,
        rejection_reason: context.rejection?.reason ?? undefined,
        rejection_check: context.rejection?.check ?? undefined,
        metadata: {
          marketSymbol: intent.params.marketSymbol,
          side: intent.params.side,
          leverage: intent.params.leverageE9,
        },
      });
    } catch {
      // Activity logging should never fail the pipeline
    }
  }
}
