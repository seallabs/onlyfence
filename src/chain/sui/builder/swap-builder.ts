import { MetaAg, EProvider } from '@7kprotocol/sdk-ts';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import type {
  ActionBuilder,
  BuiltTransaction,
  ActionPreview,
} from '../../../core/action-builder.js';
import type { SwapIntent } from '../../../core/action-types.js';

/** Shape of the best quote stored in preview.buildData */
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
 * Each builder owns: validate -> preview -> build for its operation type.
 * The pipeline doesn't know what kind of operation it is.
 */
export class SuiSwapBuilder implements ActionBuilder<SwapIntent> {
  readonly builderId = '7k-swap';
  readonly chain = 'sui';
  private readonly metaAg: MetaAg;

  constructor(slippageBps = 100) {
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

  async preview(intent: SwapIntent): Promise<ActionPreview> {
    const { coinTypeIn, coinTypeOut, amountIn } = intent.params;

    const quotes = await this.metaAg
      .quote(
        { coinTypeIn, coinTypeOut, amountIn, signer: intent.walletAddress },
        { sender: intent.walletAddress },
      )
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to fetch swap quote: ${message}`);
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

    // Select best by output amount (single pass)
    if (mapped.length === 0) {
      throw new Error('No swap quotes available');
    }

    const best = mapped.reduce((acc, q) => (BigInt(q.amountOut) > BigInt(acc.amountOut) ? q : acc));

    return {
      description: `Swap via ${best.provider}`,
      expectedOutput: best.amountOut,
      provider: best.provider,
      buildData: best,
    };
  }

  async build(intent: SwapIntent, preview: ActionPreview): Promise<BuiltTransaction> {
    const best = preview.buildData as BestQuote;

    const tx = new Transaction();
    const coinIn = coinWithBalance({ balance: BigInt(best.amountIn), type: best.coinTypeIn });
    const coinOut = await this.metaAg.swap({
      quote: best.raw as Parameters<MetaAg['swap']>[0]['quote'],
      signer: intent.walletAddress,
      tx,
      coinIn,
    });
    tx.transferObjects([coinOut], tx.pure.address(intent.walletAddress));

    return {
      transaction: tx,
      metadata: {
        action: 'swap',
        coinTypeIn: best.coinTypeIn,
        coinTypeOut: best.coinTypeOut,
        amountIn: best.amountIn,
        amountOut: best.amountOut,
        provider: best.provider,
        description: preview.description,
      },
    };
  }
}
