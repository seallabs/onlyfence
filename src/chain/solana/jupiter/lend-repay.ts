import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import BN from 'bn.js';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { RepayIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import { finishJupiterLendActivity } from './lend-base.js';

/**
 * Jupiter Lend Repay builder for Solana.
 *
 * Uses `@jup-ag/lend/borrow` SDK to repay debt via getOperateIx
 * with negative debtAmount.
 */
export class SolanaLendRepayBuilder implements ActionBuilder<RepayIntent> {
  readonly builderId = 'jupiter-lend-repay';
  readonly chain = 'solana';

  constructor(
    private readonly connection: Connection,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: RepayIntent): void {
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

  async build(intent: RepayIntent): Promise<BuiltTransaction> {
    const { getOperateIx } = await import('@jup-ag/lend/borrow');

    const signer = new PublicKey(intent.walletAddress);
    const vaultId = parseInt(intent.params.marketId, 10);

    // For repay: negative debtAmount, zero colAmount
    const debtAmount = new BN(intent.params.amount).neg();

    const { ixs, addressLookupTableAccounts } = await getOperateIx({
      vaultId,
      positionId: 0,
      colAmount: new BN(0),
      debtAmount,
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
      metadata: { protocol: 'jupiter_lend', action: 'repay', vaultId },
    };
  }

  finish(context: FinishContext): void {
    finishJupiterLendActivity(this.activityLog, context, 'lending:repay');
  }
}
