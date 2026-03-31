/**
 * ActionExecutor: transparent execution mode abstraction.
 *
 * CLI commands call createActionExecutor() to get an executor, then
 * call execute() with a raw intent. The executor handles:
 * - Wallet resolution
 * - Intent resolution (via IntentResolverRegistry)
 * - Signer acquisition (session file or daemon KeyHolder)
 * - Policy enforcement
 * - Pipeline execution
 *
 * Commands never see detectExecutionMode(), DaemonClient,
 * loadSessionKeyBytes, or executePipeline directly.
 */

import type { Logger } from 'pino';
import type { ChainAdapter } from '../chain/adapter.js';
import type { AppComponents } from '../cli/bootstrap.js';
import type { ActivityLogReader } from '../db/activity-log.js';
import { DaemonClient } from '../daemon/client.js';
import { detectExecutionMode } from '../daemon/detect.js';
import type { ExecuteResponse } from '../daemon/protocol.js';
import type { PolicyContext } from '../policy/context.js';
import { captureException } from '../telemetry/index.js';
import type { Signer } from '../types/result.js';
import { getPrimaryWallet } from '../wallet/manager.js';
import { loadSessionKeyBytes } from '../wallet/session.js';
import type { ActionIntent, Chain, ChainId, PipelineResult } from './action-types.js';
import type { DataProvider } from './data-provider.js';
import type { ResolverDeps } from './intent-resolver.js';
import { NoOpMevProtector } from './mev-protector.js';
import { executePipeline } from './transaction-pipeline.js';

/** Shared fallback MEV protector for chains without a registered protector. */
const FALLBACK_MEV_PROTECTOR = new NoOpMevProtector();

/** Result returned by ActionExecutor.execute(). */
export interface ExecutionResult {
  readonly pipelineResult: PipelineResult;
  readonly resolvedIntent: ActionIntent;
  readonly walletAddress: string;
  readonly tradeValueUsd?: number | undefined;
}

/**
 * Executes any ActionIntent transparently — callers never know
 * whether execution happens in-process or via the daemon.
 */
export interface ActionExecutor {
  execute(rawIntent: ActionIntent): Promise<ExecutionResult>;
}

// ─── In-Process Executor ──────────────────────────────────────────────────────

/**
 * Executes intents in the current process using a session-file signer.
 *
 * Used when no daemon is running (Tier 0 / standalone mode).
 */
export class InProcessActionExecutor implements ActionExecutor {
  private readonly getComponents: () => AppComponents;

  constructor(getComponents: () => AppComponents) {
    this.getComponents = getComponents;
  }

  async execute(rawIntent: ActionIntent): Promise<ExecutionResult> {
    const components = this.getComponents();
    const chain = rawIntent.chainId.split(':')[0] as Chain;
    const chainId: ChainId = rawIntent.chainId;
    const log = components.logger.child({ command: rawIntent.action, mode: 'in-process' });

    const wallet = getPrimaryWallet(components.db, chainId);
    if (wallet === null) {
      throw new Error(`No primary wallet found for chain "${chainId}". Run "fence setup" first.`);
    }
    const watchOnly = wallet.isWatchOnly;

    const chainAdapter = components.chainAdapterFactory.get(chain);
    const dataProvider = components.dataProviders.get(chain);
    const deps = buildResolverDeps(chainAdapter, dataProvider, wallet.address, components);
    const resolver = components.intentResolverRegistry.get(rawIntent.action);
    const resolved = await resolver.resolve(rawIntent, deps);

    const signer = watchOnly ? undefined : components.buildSigner(loadSessionKeyBytes(chainId));

    // Perp resolvers return perpMarketPrice/perpMarketMaxLeverage alongside the intent,
    // so we don't need a separate API call to resolve perp policy context.
    const pipelineResult = await executeWithPipeline({
      resolvedIntent: resolved.intent,
      components,
      signer,
      watchOnly,
      tradeValueUsd: resolved.tradeValueUsd,
      logger: log,
      perpMarketPrice: resolved.perpMarketPrice,
      perpMarketMaxLeverage: resolved.perpMarketMaxLeverage,
    });

    return {
      pipelineResult,
      resolvedIntent: resolved.intent,
      walletAddress: wallet.address,
      ...(resolved.tradeValueUsd !== undefined ? { tradeValueUsd: resolved.tradeValueUsd } : {}),
    };
  }
}

// ─── Daemon Client Executor ───────────────────────────────────────────────────

/**
 * Sends intents to the daemon via IPC for execution.
 *
 * Used when the daemon is running (Tier 1). The daemon holds
 * pre-decrypted keys in memory and handles resolution + signing.
 */
export class DaemonClientExecutor implements ActionExecutor {
  private readonly address: string;

  constructor(address: string) {
    this.address = address;
  }

  async execute(rawIntent: ActionIntent): Promise<ExecutionResult> {
    const client = new DaemonClient(this.address);
    const response = await client.send('execute', { intent: rawIntent });

    if (!response.ok) {
      throw new Error(response.error ?? 'Daemon returned an error with no message');
    }

    const data = response.data as ExecuteResponse | undefined;
    if (data === undefined) {
      throw new Error('Daemon returned no data in response');
    }

    return {
      pipelineResult: data.result,
      resolvedIntent: data.resolvedIntent,
      walletAddress: data.walletAddress,
      ...(data.tradeValueUsd !== undefined ? { tradeValueUsd: data.tradeValueUsd } : {}),
    };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an ActionExecutor that transparently routes based on execution mode.
 *
 * @param getComponents - Lazy AppComponents getter (only called in in-process mode)
 * @returns Executor that handles daemon routing automatically
 */
export function createActionExecutor(getComponents: () => AppComponents): ActionExecutor {
  const mode = detectExecutionMode();
  if (mode.mode === 'daemon-client') {
    return new DaemonClientExecutor(mode.address);
  }
  return new InProcessActionExecutor(getComponents);
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Build ResolverDeps from AppComponents. */
export function buildResolverDeps(
  chainAdapter: ChainAdapter,
  dataProvider: DataProvider,
  walletAddress: string,
  components: AppComponents,
): ResolverDeps {
  return {
    chainAdapter,
    dataProvider,
    walletAddress,
    services: components.resolverServices,
  };
}

/** Options for executeWithPipeline. */
export interface PipelineExecutionOptions {
  readonly resolvedIntent: ActionIntent;
  readonly components: AppComponents;
  readonly signer?: Signer | undefined;
  readonly watchOnly: boolean;
  readonly tradeValueUsd?: number | undefined;
  readonly logger: Logger;
  /** Override the activity log for policy checks (e.g., InMemoryTradeWindow in daemon). */
  readonly activityLogOverride?: ActivityLogReader | undefined;
  /** Override the app config (e.g., daemon's ConfigSnapshot.current after reload). */
  readonly configOverride?: AppComponents['config'] | undefined;
  /** Last traded price (USD) for perp order size / leverage policy checks. */
  readonly perpMarketPrice?: number | undefined;
  /** On-chain max leverage for perp leverage cap policy check. */
  readonly perpMarketMaxLeverage?: number | undefined;
}

/**
 * Common pipeline execution shared by InProcessActionExecutor
 * and DaemonExecutor (via import).
 */
export async function executeWithPipeline(opts: PipelineExecutionOptions): Promise<PipelineResult> {
  const { resolvedIntent, components, signer, watchOnly, tradeValueUsd, logger } = opts;
  const chain = resolvedIntent.chainId.split(':')[0] as Chain;
  const chainAdapter = components.chainAdapterFactory.get(chain);
  const dataProvider = components.dataProviders.get(chain);
  const config = opts.configOverride ?? components.config;

  const chainConfig = config.chain[chain];
  const policyCtx: PolicyContext = {
    config: chainConfig,
    activityLog: opts.activityLogOverride ?? components.activityLog,
    ...(tradeValueUsd !== undefined ? { tradeValueUsd } : {}),
    ...(opts.perpMarketPrice !== undefined ? { perpMarketPrice: opts.perpMarketPrice } : {}),
    ...(opts.perpMarketMaxLeverage !== undefined
      ? { perpMarketMaxLeverage: opts.perpMarketMaxLeverage }
      : {}),
  };

  const builder = components.actionBuilderRegistry.getDefault(
    chain,
    resolvedIntent.action,
    resolvedIntent,
  );
  const mevProtector = components.mevProtectors.get(chain) ?? FALLBACK_MEV_PROTECTOR;

  const result = await executePipeline({
    intent: resolvedIntent,
    builder,
    chainAdapter,
    policyRegistry: components.policyRegistry,
    policyContext: policyCtx,
    mevProtector,
    logger,
    ...(signer !== undefined ? { signer } : {}),
    watchOnly,
    dataProvider,
  });

  if (result.status === 'error' && result.error !== undefined) {
    captureException(new Error(result.error));
  }

  return result;
}
