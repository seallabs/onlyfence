import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import BN from 'bn.js';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { BorrowIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import { finishJupiterLendActivity } from './lend-base.js';

/**
 * Jupiter Lend Borrow builder for Solana.
 *
 * Uses `@jup-ag/lend/borrow` SDK to get borrow instructions.
 * Critical: must pass addressLookupTableAccounts to compileToV0Message().
 */
export class SolanaLendBorrowBuilder implements ActionBuilder<BorrowIntent> {
  readonly builderId = 'jupiter-lend-borrow';
  readonly chain = 'solana';

  constructor(
    private readonly connection: Connection,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: BorrowIntent): void {
    if (intent.params.coinType === '') {
      throw new Error('Missing token type');
    }
    if (intent.params.amount === '' || BigInt(intent.params.amount) <= 0n) {
      throw new Error('Invalid amount');
    }
    if (intent.params.marketId === '') {
      throw new Error('Missing vault/market ID');
    }
  }

  async build(intent: BorrowIntent): Promise<BuiltTransaction> {
    const { getOperateIx } = await import('@jup-ag/lend/borrow');

    const signer = new PublicKey(intent.walletAddress);
    const vaultId = parseInt(intent.params.marketId, 10);

    // For borrow: positive debtAmount, zero colAmount (no additional collateral)
    const { ixs, addressLookupTableAccounts } = await getOperateIx({
      vaultId,
      positionId: 0,
      colAmount: new BN(0),
      debtAmount: new BN(intent.params.amount),
      connection: this.connection,
      signer,
    });

    // CRITICAL: pass addressLookupTableAccounts to compileToV0Message
    const { blockhash } = await this.connection.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: signer,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message(addressLookupTableAccounts);
    const tx = new VersionedTransaction(message);

    return {
      transaction: tx,
      metadata: { protocol: 'jupiter_lend', action: 'borrow', vaultId },
    };
  }

  finish(context: FinishContext): void {
    finishJupiterLendActivity(this.activityLog, context, 'lending:borrow');
  }
}
