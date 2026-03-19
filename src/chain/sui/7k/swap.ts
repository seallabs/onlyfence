import { EProvider, MetaAg } from '@7kprotocol/sdk-ts';
import {
  Transaction,
  coinWithBalance,
  type TransactionObjectArgument,
} from '@mysten/sui/transactions';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { SwapIntent } from '../../../core/action-types.js';
import type { TradeLog } from '../../../db/trade-log.js';
import { toErrorMessage } from '../../../utils/index.js';
import type { SuiTxResponse } from '../adapter.js';
import type { SwapEventAmounts } from './events.js';
import { parseSwapEvent } from './events.js';

/** Shape of the best quote selected during build */
interface BestQuote {
  readonly provider: string;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly coinTypeIn: string;
  readonly coinTypeOut: string;
  readonly raw: unknown;
}

/**
 * 7K Meta Aggregator swap builder for Sui.
 * Implements ActionBuilder for the "swap" action.
 *
 * Pattern: each DeFi operation gets its own builder:
 *   - SuiSwapBuilder      -> swap via 7K aggregator
 *   - NaviSupplyBuilder    -> NAVI lending supply (future)
 *   - SuiLpDepositBuilder  -> LP deposit via LP Pro (future)
 *
 * Each builder owns: validate -> build -> finish for its operation type.
 * The pipeline doesn't know what kind of operation it is.
 */
export class SuiSwapBuilder implements ActionBuilder<SwapIntent, SuiTxResponse> {
  readonly builderId = '7k-swap';
  readonly chain = 'sui';
  private readonly metaAg: MetaAg;

  constructor(
    private readonly tradeLog: TradeLog,
    slippageBps = 100,
  ) {
    this.metaAg = new MetaAg({
      slippageBps,
      tipBps: 0,
      providers: {
        [EProvider.CETUS]: { disabled: false },
        [EProvider.BLUEFIN7K]: { disabled: false },
        [EProvider.FLOWX]: { disabled: false },
      },
    });
  }

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

  async build(intent: SwapIntent): Promise<BuiltTransaction> {
    const { coinTypeIn, coinTypeOut, amountIn } = intent.params;

    // Fetch quotes from 7K aggregator
    const quotes = await this.metaAg
      .quote(
        { coinTypeIn, coinTypeOut, amountIn, signer: intent.walletAddress },
        { sender: intent.walletAddress },
      )
      .catch((e: unknown) => {
        throw new Error(`Failed to fetch swap quote: ${toErrorMessage(e)}`);
      });

    // Map quotes to a normalized shape, preferring simulatedAmountOut over amountOut
    const mapped: BestQuote[] = quotes.map((q) => ({
      provider: q.provider,
      amountIn: q.amountIn,
      amountOut: q.simulatedAmountOut ?? q.amountOut,
      coinTypeIn: q.coinTypeIn,
      coinTypeOut: q.coinTypeOut,
      raw: q,
    }));

    if (mapped.length === 0) {
      throw new Error('No swap quotes available');
    }

    // Select best by output amount (single pass)
    const best = mapped.reduce((acc, q) => (BigInt(q.amountOut) > BigInt(acc.amountOut) ? q : acc));

    // Build transaction from the best quote
    const tx = new Transaction();
    const coinIn = coinWithBalance({ balance: BigInt(best.amountIn), type: best.coinTypeIn })(tx);
    // Cast through unknown to bridge ESM/CJS dual-module boundary with @7kprotocol/sdk-ts
    const coinOut = await this.metaAg.swap({
      quote: best.raw as Parameters<MetaAg['swap']>[0]['quote'],
      signer: intent.walletAddress,
      tx: tx as unknown as Parameters<MetaAg['swap']>[0]['tx'],
      coinIn: coinIn as unknown as Parameters<MetaAg['swap']>[0]['coinIn'],
    });
    tx.transferObjects(
      [coinOut as TransactionObjectArgument],
      tx.pure.address(intent.walletAddress),
    );

    return {
      transaction: tx,
      metadata: {
        action: 'swap',
        description: `Swap via ${best.provider}`,
        expectedOutput: best.amountOut,
        provider: best.provider,
        coinTypeIn: best.coinTypeIn,
        coinTypeOut: best.coinTypeOut,
        amountIn: best.amountIn,
      },
    };
  }

  /**
   * Post-execution hook: parse on-chain swap events and log the trade to DB.
   *
   * Called by the pipeline after rejection, watch-only simulation, or
   * successful execution.
   */
  finish(context: FinishContext<SuiTxResponse>): void {
    const { intent, status, metadata, rawResponse, txDigest, gasUsed, rejection } = context;

    if (intent.action !== 'swap') return;

    // Parse actual amounts from on-chain events (source of truth)
    const parsed = rawResponse !== undefined ? this.parseAmounts(rawResponse) : undefined;
    const expectedOutput = metadata?.['expectedOutput'];
    const amountOut =
      parsed?.amountOut ?? (typeof expectedOutput === 'string' ? expectedOutput : undefined);

    this.tradeLog.logTrade({
      chain_id: intent.chainId,
      wallet_address: intent.walletAddress,
      action: intent.action,
      from_token: intent.params.coinTypeIn,
      to_token: intent.params.coinTypeOut,
      from_coin_type: intent.params.coinTypeIn,
      to_coin_type: intent.params.coinTypeOut,
      amount_in: intent.params.amountIn,
      policy_decision: status,
      ...(amountOut !== undefined ? { amount_out: amountOut } : {}),
      ...(txDigest !== undefined ? { tx_digest: txDigest } : {}),
      ...(gasUsed !== undefined ? { gas_cost: gasUsed } : {}),
      ...(rejection?.reason !== undefined ? { rejection_reason: rejection.reason } : {}),
      ...(rejection?.check !== undefined ? { rejection_check: rejection.check } : {}),
      ...(intent.tradeValueUsd !== undefined ? { value_usd: intent.tradeValueUsd } : {}),
    });
  }

  parseAmounts(rawResponse: SuiTxResponse): SwapEventAmounts | undefined {
    const events = rawResponse.events;
    if (!Array.isArray(events)) return undefined;
    return parseSwapEvent(events as { type: string; parsedJson: unknown }[]);
  }
}
