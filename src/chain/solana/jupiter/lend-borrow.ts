import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import type { Connection, Keypair } from '@solana/web3.js';
import BN from 'bn.js';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { BorrowIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import { finishJupiterLendActivity } from './lend-base.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
// Reserve enough lamports to cover position init + operate gas fees
const SOL_GAS_RESERVE = 5_000_000; // 0.005 SOL

/**
 * Jupiter Lend Borrow builder for Solana.
 *
 * Uses off-chain-signed strategy because borrow requires two sequential
 * on-chain transactions:
 *   1. getInitPositionIx — create a new borrow position (NFT)
 *   2. getOperateIx     — deposit collateral + borrow in one call
 *
 * The position init tx must be confirmed before getOperateIx is built,
 * because the SDK reads the position account on-chain during instruction
 * construction.
 *
 * Vault discovery: scans on-chain VaultConfig accounts to find the first
 * vault where borrowToken matches the requested token and the user holds
 * a non-zero balance of the vault's supplyToken. Pass --market <vaultId>
 * to override with an explicit numeric vault ID.
 */
export class SolanaLendBorrowBuilder implements ActionBuilder<BorrowIntent> {
  readonly builderId = 'jupiter-lend-borrow';
  readonly chain = 'solana';
  readonly executionStrategy = 'off-chain-signed' as const;

  constructor(
    private readonly connection: Connection,
    private readonly getKeypair: () => Keypair,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: BorrowIntent): void {
    if (intent.params.coinType === '') throw new Error('Missing token type');
    if (intent.params.amount === '' || BigInt(intent.params.amount) <= 0n) {
      throw new Error('Invalid amount');
    }
  }

  build(_intent: BorrowIntent): Promise<BuiltTransaction> {
    // No-op: execution is handled entirely in execute()
    return Promise.resolve({ transaction: null, metadata: {} });
  }

  async execute(intent: BorrowIntent): Promise<{ metadata: Record<string, unknown> }> {
    const { getOperateIx, getInitPositionIx, getVaultsProgram } =
      await import('@jup-ag/lend/borrow');

    const keypair = this.getKeypair();
    const signer = keypair.publicKey;
    const borrowMint = new PublicKey(intent.params.coinType);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const program: any = getVaultsProgram({ connection: this.connection, signer });

    // Resolve vault ID: numeric override or discover from collateral balances
    const explicitId = parseInt(intent.params.marketId, 10);
    const vaultId = !isNaN(explicitId)
      ? explicitId
      : await this.discoverVaultId(borrowMint, signer, program);

    // Determine collateral token and user's available balance
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const allConfigs: { account: { vaultId: number; supplyToken: PublicKey } }[] =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await program.account.vaultConfig.all();
    const vaultConfig = allConfigs.find((c) => c.account.vaultId === vaultId);
    if (vaultConfig === undefined)
      throw new Error(`Jupiter Lend vault ${vaultId} not found on-chain`);

    const colAmount = await this.getCollateralBalance(signer, vaultConfig.account.supplyToken);

    // Step 1: Initialize a new borrow position and wait for confirmation
    const { ix: initIx, nftId: positionId } = await getInitPositionIx({
      vaultId,
      connection: this.connection,
      signer,
    });

    const { blockhash: initBlockhash, lastValidBlockHeight: initLastValidBlockHeight } =
      await this.connection.getLatestBlockhash();
    const initMessage = new TransactionMessage({
      payerKey: signer,
      recentBlockhash: initBlockhash,
      instructions: [initIx],
    }).compileToV0Message();
    const initTx = new VersionedTransaction(initMessage);
    initTx.sign([keypair]);

    const initSig = await this.connection.sendRawTransaction(initTx.serialize(), {
      skipPreflight: false,
    });
    await this.connection.confirmTransaction(
      {
        signature: initSig,
        blockhash: initBlockhash,
        lastValidBlockHeight: initLastValidBlockHeight,
      },
      'confirmed',
    );

    // Step 2: Deposit collateral + borrow (position now exists on-chain)
    const { ixs: operateIxs, addressLookupTableAccounts } = await getOperateIx({
      vaultId,
      positionId,
      colAmount,
      debtAmount: new BN(intent.params.amount),
      connection: this.connection,
      signer,
    });

    const { blockhash: operateBlockhash, lastValidBlockHeight: operateLastValidBlockHeight } =
      await this.connection.getLatestBlockhash();
    const operateMessage = new TransactionMessage({
      payerKey: signer,
      recentBlockhash: operateBlockhash,
      instructions: operateIxs,
    }).compileToV0Message(addressLookupTableAccounts);
    const operateTx = new VersionedTransaction(operateMessage);
    operateTx.sign([keypair]);

    const borrowSig = await this.connection.sendRawTransaction(operateTx.serialize(), {
      skipPreflight: false,
    });
    await this.connection.confirmTransaction(
      {
        signature: borrowSig,
        blockhash: operateBlockhash,
        lastValidBlockHeight: operateLastValidBlockHeight,
      },
      'confirmed',
    );

    return {
      metadata: {
        txDigest: borrowSig,
        initTxDigest: initSig,
        vaultId,
        positionId,
      },
    };
  }

  finish(context: FinishContext): void {
    // Borrow txDigest lives in metadata (off-chain-signed pipeline omits context.txDigest)
    const txDigest =
      context.txDigest ?? (context.metadata?.['txDigest'] as string | undefined) ?? undefined;
    finishJupiterLendActivity(this.activityLog, context, 'lending:borrow', txDigest);
  }

  /**
   * Scan all on-chain VaultConfig accounts to find the first vault where
   * borrowToken matches and the user holds a non-zero collateral balance.
   */
  private async discoverVaultId(
    borrowMint: PublicKey,
    signer: PublicKey,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    program: any,
  ): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const allConfigs: {
      account: { vaultId: number; borrowToken: PublicKey; supplyToken: PublicKey };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    }[] = await program.account.vaultConfig.all();

    for (const { account } of allConfigs) {
      if (!account.borrowToken.equals(borrowMint)) continue;
      const balance = await this.getCollateralBalance(signer, account.supplyToken);
      if (balance.gtn(0)) return account.vaultId;
    }

    throw new Error(
      `No Jupiter Lend vault found where you hold collateral for borrowing ${borrowMint.toBase58()}. ` +
        'Supply a supported collateral token (e.g. SOL) or pass --market <vaultId>.',
    );
  }

  /**
   * Returns the usable collateral balance for a given supply token mint.
   * For native SOL, reserves SOL_GAS_RESERVE lamports for transaction fees.
   */
  private async getCollateralBalance(signer: PublicKey, supplyTokenMint: PublicKey): Promise<BN> {
    if (supplyTokenMint.toBase58() === SOL_MINT) {
      const lamports = await this.connection.getBalance(signer);
      return new BN(Math.max(0, lamports - SOL_GAS_RESERVE));
    }
    try {
      const { getAssociatedTokenAddress } = await import('@solana/spl-token');
      const ata = await getAssociatedTokenAddress(supplyTokenMint, signer);
      const info = await this.connection.getTokenAccountBalance(ata);
      return new BN(info.value.amount);
    } catch {
      return new BN(0);
    }
  }
}
