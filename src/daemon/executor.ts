/**
 * Daemon trade executor: wraps executePipeline() with daemon-held components.
 *
 * The executor reuses the exact same transaction pipeline as the CLI.
 * The difference is that:
 * - The signer comes from KeyHolder (in-memory) instead of a session file
 * - The policy context uses InMemoryTradeWindow instead of SQLite
 * - The config comes from ConfigSnapshot (immutable until reload)
 */

import type { Logger } from 'pino';
import type { Chain, PipelineResult, SwapIntent } from '../core/action-types.js';
import { NoOpMevProtector } from '../core/mev-protector.js';
import { executePipeline } from '../core/transaction-pipeline.js';
import { resolveTokenInput } from '../cli/resolve.js';
import { getPrimaryWallet } from '../wallet/manager.js';
import type { AppComponents } from '../cli/bootstrap.js';
import type { PolicyContext } from '../policy/context.js';
import type { TradePayload } from './protocol.js';
import type { KeyHolder } from './key-holder.js';
import type { ConfigSnapshot } from './config-snapshot.js';
import type { InMemoryTradeWindow } from './trade-window.js';

export class DaemonExecutor {
  constructor(
    private readonly components: AppComponents,
    private readonly keyHolder: KeyHolder,
    private readonly configSnapshot: ConfigSnapshot,
    private readonly tradeWindow: InMemoryTradeWindow,
    private readonly logger: Logger,
  ) {}

  /**
   * Execute a trade intent through the full pipeline.
   *
   * The thin client sends raw CLI args (token symbols, human-readable amounts).
   * This method resolves them to canonical coin types and scaled amounts —
   * the same resolution the in-process CLI flow performs.
   */
  async executeTrade(payload: TradePayload): Promise<PipelineResult> {
    const { intent } = payload;
    const log = this.logger.child({ action: intent.action, chainId: intent.chainId });
    const chain = intent.chainId.split(':')[0] as Chain | undefined;

    if (chain === undefined) {
      return { status: 'error', error: `Invalid chainId: ${intent.chainId}` };
    }

    const config = this.configSnapshot.current;
    const chainConfig = config.chain[chain];
    const chainAdapter = this.components.chainAdapterFactory.get(chain);
    const dataProvider = this.components.dataProviders.get(chain);

    // Resolve wallet if not provided
    const rawParams = intent.params as Record<string, unknown>;
    let walletAddress = intent.walletAddress;
    if (walletAddress === '') {
      const wallet = getPrimaryWallet(this.components.db, intent.chainId);
      if (wallet === null) {
        return { status: 'error', error: `No primary wallet for chain "${intent.chainId}"` };
      }
      walletAddress = wallet.address;
    }

    // Resolve token symbols → coin types, scale amounts
    const rawFromToken = typeof rawParams['coinTypeIn'] === 'string' ? rawParams['coinTypeIn'] : '';
    const rawToToken = typeof rawParams['coinTypeOut'] === 'string' ? rawParams['coinTypeOut'] : '';
    const rawAmount = typeof rawParams['amountIn'] === 'string' ? rawParams['amountIn'] : '0';
    const slippageBps = Number(rawParams['slippageBps'] ?? 100);

    const resolvedIn = await resolveTokenInput(rawFromToken, rawAmount, chainAdapter, dataProvider);
    const coinTypeOut = chainAdapter.resolveTokenAddress(rawToToken);

    // Fetch price for policy checks (fail-closed via PriceCache)
    const price = await dataProvider.getPrice(resolvedIn.coinType);
    const tradeValueUsd = parseFloat(rawAmount) * price;

    // Build resolved intent
    const resolvedIntent: SwapIntent = {
      chainId: intent.chainId,
      action: 'trade:swap',
      walletAddress,
      params: {
        coinTypeIn: resolvedIn.coinType,
        coinTypeOut,
        amountIn: resolvedIn.scaledAmount,
        slippageBps,
      },
      tradeValueUsd,
    };

    // Build policy context with in-memory trade window
    const policyCtx: PolicyContext = {
      config: chainConfig,
      activityLog: this.tradeWindow,
      tradeValueUsd,
    };

    // Get signer from key holder
    const signer = this.keyHolder.getSigner(intent.chainId);

    // Get builder and chain adapter
    const builder = this.components.actionBuilderRegistry.getDefault(
      chain,
      resolvedIntent.action,
      resolvedIntent,
    );
    const mevProtector = this.components.mevProtectors.get(chain) ?? new NoOpMevProtector();

    const result = await executePipeline({
      intent: resolvedIntent,
      builder,
      chainAdapter,
      policyRegistry: this.components.policyRegistry,
      policyContext: policyCtx,
      mevProtector,
      logger: log,
      signer,
      watchOnly: false,
    });

    // Record approved trades in the in-memory window
    if (result.status === 'success') {
      this.tradeWindow.record(intent.chainId, tradeValueUsd);
    }

    // Also log to SQLite for persistence
    if (result.status === 'success' || result.status === 'rejected') {
      try {
        this.components.activityLog.logActivity({
          chain_id: resolvedIntent.chainId,
          wallet_address: walletAddress,
          action: 'trade:swap',
          token_a_type: resolvedIn.coinType,
          token_a_amount: resolvedIn.scaledAmount,
          token_b_type: coinTypeOut,
          value_usd: tradeValueUsd,
          ...(result.txDigest !== undefined ? { tx_digest: result.txDigest } : {}),
          ...(typeof result.gasUsed === 'string' ? { gas_cost: parseFloat(result.gasUsed) } : {}),
          policy_decision: result.status === 'rejected' ? 'rejected' : 'approved',
          ...(result.rejectionReason !== undefined
            ? { rejection_reason: result.rejectionReason }
            : {}),
          ...(result.rejectionCheck !== undefined
            ? { rejection_check: result.rejectionCheck }
            : {}),
        });
      } catch (err: unknown) {
        log.warn({ err }, 'Failed to persist trade to SQLite (in-memory window still updated)');
      }
    }

    return result;
  }
}
