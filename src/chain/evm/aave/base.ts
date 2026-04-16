import type { EthereumTransactionTypeExtended, Pool } from '@aave/contract-helpers';
import type { Wallet } from 'ethers';
import { formatUnits } from 'viem';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { ActivityAction, TokenLendingIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { EvmWalletContext } from '../wallet.js';
import { getKnownDecimals, isNativeEth } from '../tokens.js';

/**
 * Convert an intent's smallest-unit amount string into the human-readable
 * decimal string the Aave SDK expects.
 *
 * Rejects native ETH (Aave V3 wraps ETH via the WETH Gateway which requires
 * a separate code path) and unknown tokens (no decimals → cannot format).
 */
export function toAaveHumanAmount(coinType: string, smallestUnitAmount: string): string {
  if (isNativeEth(coinType)) {
    throw new Error(
      'Aave V3 lending of native ETH requires the WETH Gateway path — supply WETH directly instead.',
    );
  }
  const decimals = getKnownDecimals(coinType);
  if (decimals === undefined) {
    throw new Error(`Unknown EVM token "${coinType}" — cannot format amount for Aave SDK.`);
  }
  const raw = BigInt(smallestUnitAmount);
  if (raw <= 0n) {
    throw new Error(`Aave lending amount must be greater than zero, got "${smallestUnitAmount}".`);
  }
  return formatUnits(raw, decimals);
}

/**
 * Submit the ordered list of transactions returned by any Aave SDK
 * pool method (supply / withdraw / borrow / repay).
 *
 * Populating each PopulatedTransaction is pure marshaling and can run
 * concurrently; actual submission must be serial so ethers assigns
 * strictly increasing nonces. Returns the last hash as the "main"
 * action hash (earlier entries are ERC-20 approvals).
 */
export async function submitAaveTransactions(
  txs: EthereumTransactionTypeExtended[],
  signer: Wallet,
): Promise<{ mainTxHash: string; approvalTxHashes: string[] }> {
  if (txs.length === 0) {
    throw new Error('Aave SDK returned no transactions to submit');
  }

  const populatedTxs = await Promise.all(txs.map((entry) => entry.tx()));

  const approvalTxHashes: string[] = [];
  let mainTxHash = '';
  const lastIndex = populatedTxs.length - 1;

  for (const [index, populatedTx] of populatedTxs.entries()) {
    // Ethers requires the signer to populate `from` implicitly;
    // passing it explicitly breaks estimateGas on some node versions.
    delete populatedTx.from;
    const submitted = await signer.sendTransaction(populatedTx);
    const receipt = await submitted.wait();
    if (index === lastIndex) {
      mainTxHash = receipt.transactionHash;
    } else {
      approvalTxHashes.push(receipt.transactionHash);
    }
  }

  return { mainTxHash, approvalTxHashes };
}

/** Log a standardized Aave lending activity row. */
export function finishAaveLendActivity(
  activityLog: ActivityLog,
  context: FinishContext,
  action: ActivityAction,
): void {
  const intent = context.intent as TokenLendingIntent;
  activityLog.logActivity({
    chain_id: intent.chainId,
    wallet_address: intent.walletAddress,
    action,
    protocol: 'aave_v3',
    token_a_type: intent.params.coinType,
    token_a_amount: intent.params.amount,
    value_usd: intent.valueUsd ?? undefined,
    tx_digest:
      context.txDigest ?? (context.metadata?.['txDigest'] as string | undefined) ?? undefined,
    gas_cost: context.gasUsed ?? undefined,
    policy_decision: context.status,
    rejection_reason: context.rejection?.reason ?? undefined,
    rejection_check: context.rejection?.check ?? undefined,
  });
}

/**
 * Shared scaffolding for every Aave V3 lend builder.
 *
 * Subclasses supply:
 * - `builderId`, `activityAction`, `aaveAction` (identity + logging)
 * - `callPool()` — the SDK method to invoke with the resolved amount
 *
 * Subclasses may override `resolveAmount()` / `validateAmount()` when
 * an operation supports the `-1` full-position sentinel (withdraw, repay).
 */
export abstract class AaveLendBuilderBase<
  I extends TokenLendingIntent,
> implements ActionBuilder<I> {
  readonly chain = 'ethereum';
  readonly executionStrategy = 'off-chain-signed' as const;
  abstract readonly builderId: string;
  protected abstract readonly activityAction: ActivityAction;
  protected abstract readonly aaveAction: string;

  constructor(
    protected readonly pool: Pool,
    protected readonly getWallet: () => EvmWalletContext,
    protected readonly activityLog: ActivityLog,
  ) {}

  validate(intent: I): void {
    if (intent.params.coinType === '') {
      throw new Error('Missing reserve token');
    }
    this.validateAmount(intent);
  }

  protected validateAmount(intent: I): void {
    if (intent.params.amount === '') {
      throw new Error(`Missing ${this.aaveAction} amount`);
    }
  }

  build(_intent: I): Promise<BuiltTransaction> {
    return Promise.resolve({ transaction: null, metadata: {} });
  }

  async execute(intent: I): Promise<{ metadata: Record<string, unknown> }> {
    const wallet = this.getWallet();
    const user = wallet.account.address;
    const amount = this.resolveAmount(intent);

    const txs = await this.callPool(intent, user, amount);
    const { mainTxHash, approvalTxHashes } = await submitAaveTransactions(txs, wallet.ethersSigner);

    return {
      metadata: {
        txDigest: mainTxHash,
        approvalTxHashes,
        humanAmount: amount,
        protocol: 'aave_v3',
        action: this.aaveAction,
      },
    };
  }

  protected resolveAmount(intent: I): string {
    return toAaveHumanAmount(intent.params.coinType, intent.params.amount);
  }

  protected abstract callPool(
    intent: I,
    user: string,
    humanAmount: string,
  ): Promise<EthereumTransactionTypeExtended[]>;

  finish(context: FinishContext): void {
    finishAaveLendActivity(this.activityLog, context, this.activityAction);
  }
}
