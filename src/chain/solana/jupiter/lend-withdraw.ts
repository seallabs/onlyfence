import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import BN from 'bn.js';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { WithdrawIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import { finishJupiterLendActivity } from './lend-base.js';

/**
 * Jupiter Lend Earn withdraw builder for Solana.
 *
 * Uses `@jup-ag/lend/earn` SDK to get withdraw instructions,
 * assembles them into a VersionedTransaction.
 */
export class SolanaLendWithdrawBuilder implements ActionBuilder<WithdrawIntent> {
  readonly builderId = 'jupiter-lend-withdraw';
  readonly chain = 'solana';

  constructor(
    private readonly connection: Connection,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: WithdrawIntent): void {
    if (intent.params.coinType === '') {
      throw new Error('Missing token type');
    }
    if (
      intent.params.withdrawAll !== true &&
      (intent.params.amount === '' || BigInt(intent.params.amount) <= 0n)
    ) {
      throw new Error('Invalid amount');
    }
  }

  async build(intent: WithdrawIntent): Promise<BuiltTransaction> {
    const { getWithdrawIxs, MAX_WITHDRAW } = await import('@jup-ag/lend/earn');

    const signer = new PublicKey(intent.walletAddress);
    const asset = new PublicKey(intent.params.coinType);
    const amount = intent.params.withdrawAll === true ? MAX_WITHDRAW : new BN(intent.params.amount);

    const { ixs } = await getWithdrawIxs({
      amount,
      asset,
      signer,
      connection: this.connection,
    });

    const { blockhash } = await this.connection.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: signer,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);

    return {
      transaction: tx,
      metadata: { protocol: 'jupiter_lend', action: 'withdraw' },
    };
  }

  finish(context: FinishContext): void {
    finishJupiterLendActivity(this.activityLog, context, 'lending:withdraw');
  }
}
