/**
 * Daemon executor: wraps the shared executeWithPipeline() with daemon-held
 * components. The only differences from the in-process executor:
 * - The signer comes from KeyHolder (in-memory) instead of a session file
 * - The policy context uses InMemoryTradeWindow instead of SQLite
 * - The config comes from ConfigSnapshot (immutable until reload)
 *
 * The generic executeAction() method delegates resolution to the shared
 * IntentResolverRegistry, making it action-type agnostic.
 */

import type { Logger } from 'pino';
import type { PipelineResult } from '../core/action-types.js';
import { buildResolverDeps, executeWithPipeline } from '../core/action-executor.js';
import { getPrimaryWallet } from '../wallet/manager.js';
import type { AppComponents } from '../cli/bootstrap.js';
import type { ExecutePayload, ExecuteResponse, TradePayload } from './protocol.js';
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
   * Execute any action intent through the full pipeline.
   *
   * Delegates action-specific resolution to IntentResolverRegistry,
   * then uses the shared executeWithPipeline() for the common path.
   * Only the signer source and policy activity log differ from in-process.
   */
  async executeAction(payload: ExecutePayload): Promise<ExecuteResponse> {
    const { intent: rawIntent } = payload;
    const log = this.logger.child({ action: rawIntent.action, chainId: rawIntent.chainId });

    // Resolve wallet if not provided
    let walletAddress = rawIntent.walletAddress;
    if (walletAddress === '') {
      const wallet = getPrimaryWallet(this.components.db, rawIntent.chainId);
      if (wallet === null) {
        return {
          result: { status: 'error', error: `No primary wallet for chain "${rawIntent.chainId}"` },
          resolvedIntent: rawIntent,
          walletAddress: '',
        };
      }
      walletAddress = wallet.address;
    }

    // Resolve intent via shared resolver registry
    const chain = rawIntent.chainId.split(':')[0] ?? '';
    const chainAdapter = this.components.chainAdapterFactory.get(chain);
    const dataProvider = this.components.dataProviders.get(chain);
    const deps = buildResolverDeps(chainAdapter, dataProvider, walletAddress, this.components);
    const resolver = this.components.intentResolverRegistry.get(rawIntent.action);
    const resolved = await resolver.resolve(rawIntent, deps);

    // Get signer from daemon's KeyHolder (pre-decrypted keys in memory)
    const signer = this.keyHolder.getSigner(rawIntent.chainId);

    // Execute through the shared pipeline, using InMemoryTradeWindow for policy.
    // Perp resolvers return perpMarketPrice/perpMarketMaxLeverage alongside the intent,
    // so we don't need a separate API call to resolve perp policy context.
    const result = await executeWithPipeline({
      resolvedIntent: resolved.intent,
      components: this.components,
      signer,
      watchOnly: false,
      tradeValueUsd: resolved.tradeValueUsd,
      logger: log,
      activityLogOverride: this.tradeWindow,
      configOverride: this.configSnapshot.current,
      perpMarketPrice: resolved.perpMarketPrice,
      perpMarketMaxLeverage: resolved.perpMarketMaxLeverage,
    });

    // Record in in-memory trade window for spending limit tracking.
    // SQLite persistence is handled by builder.finish() inside the pipeline —
    // do NOT duplicate it here (every builder already calls logActivity in finish()).
    if (result.status === 'success' && resolved.tradeValueUsd !== undefined) {
      this.tradeWindow.record(rawIntent.chainId, resolved.tradeValueUsd, rawIntent.action);
    }

    return {
      result,
      resolvedIntent: resolved.intent,
      walletAddress,
      ...(resolved.tradeValueUsd !== undefined ? { tradeValueUsd: resolved.tradeValueUsd } : {}),
    };
  }

  /**
   * Execute a trade intent (backwards-compatible alias for executeAction).
   *
   * @deprecated Use executeAction() for new code.
   */
  async executeTrade(payload: TradePayload): Promise<PipelineResult> {
    const response = await this.executeAction({ intent: payload.intent });
    return response.result;
  }
}
