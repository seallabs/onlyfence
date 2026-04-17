import { Connection, Keypair } from '@solana/web3.js';
import type { ChainModule, ChainModuleInfo, ChainRegistrationContext } from '../chain-module.js';
import { DataProviderWithCache } from '../../core/data-provider.js';
import { NoOpMevProtector } from '../../core/mev-protector.js';
import { PriceCache } from '../../core/price-cache.js';
import { TokenAllowlistCheck } from '../../policy/checks/token-allowlist.js';
import { loadSessionKeyBytes as loadSessionKeyBytesSync } from '../../wallet/session.js';
import { SolanaAdapter } from './adapter.js';
import { SolanaDataProvider } from './data-provider.js';
import { DEFAULT_SOLANA_CHAIN_CONFIG, SOLANA_MAINNET_RPC } from './defaults.js';
import { SolanaKeyDeriver } from './key-deriver.js';
import { SOLANA_CHAIN_ID } from './adapter.js';
import { buildSolanaSigner } from './signer.js';
import { tryResolveTokenAddress, SOLANA_KNOWN_DECIMALS } from './tokens.js';
import { JupiterClient } from './jupiter/client.js';
import { SolanaSwapBuilder } from './jupiter/swap.js';
import { SolanaLendSupplyBuilder } from './jupiter/lend-supply.js';
import { SolanaLendWithdrawBuilder } from './jupiter/lend-withdraw.js';
import { SolanaLendBorrowBuilder } from './jupiter/lend-borrow.js';
import { SolanaLendRepayBuilder } from './jupiter/lend-repay.js';
import { resolveJupiterLendMarketId } from './jupiter/lend-markets.js';
import { SolanaPerpPlaceOrderBuilder } from './jupiter/perp-place-order.js';
import { SolanaPerpCancelOrderBuilder } from './jupiter/perp-cancel-order.js';
import { JupiterPerpProvider } from './jupiter/perp-provider.js';
import { createPerpetualsProgram } from './perps/program.js';

/**
 * Solana chain module -- registers all Solana-specific components.
 *
 * Encapsulates: SolanaAdapter, SolanaDataProvider, Jupiter swap/lend/perp
 * builders, key deriver, signer factory, and policy checks.
 */
export class SolanaChainModule implements ChainModule {
  readonly info: ChainModuleInfo = {
    chain: 'solana',
    displayName: 'Solana',
    defaultRpc: SOLANA_MAINNET_RPC,
    defaultNetwork: 'mainnet',
    credentialRequirements: [
      {
        name: 'jupiter_api_key',
        description: 'Jupiter API key (required -- get one free at portal.jup.ag)',
        envVar: 'JUPITER_API_KEY',
        required: true,
      },
    ],
    defaultChainConfig: DEFAULT_SOLANA_CHAIN_CONFIG,
  };

  /** Solana RPC connection — available after register(). */
  connection: Connection | undefined;

  /** Jupiter HTTP client — available after register(). */
  jupiterClient: JupiterClient | undefined;

  private cachedKeypair: Keypair | undefined;

  createKeyDeriver(): SolanaKeyDeriver {
    return new SolanaKeyDeriver();
  }

  register(ctx: ChainRegistrationContext): void {
    const rpc = ctx.config.rpc;
    const jupiterApiKey = ctx.config.credentials?.['jupiter_api_key'];

    if (jupiterApiKey === undefined || jupiterApiKey.trim() === '') {
      throw new Error(
        'Solana chain requires a Jupiter API key. ' +
          'Run "fence setup" or set JUPITER_API_KEY environment variable.',
      );
    }

    const connection = new Connection(rpc, 'confirmed');
    const jupiterClient = new JupiterClient(jupiterApiKey);

    this.connection = connection;
    this.jupiterClient = jupiterClient;

    // Lazy keypair loader (same pattern as Sui's BluefinClient)
    const getKeypair = (): Keypair => {
      if (this.cachedKeypair !== undefined) return this.cachedKeypair;

      const keyBytes = loadSessionKeyBytesSync(SOLANA_CHAIN_ID);
      this.cachedKeypair =
        keyBytes.length === 64
          ? Keypair.fromSecretKey(keyBytes)
          : Keypair.fromSeed(keyBytes.subarray(0, 32));
      return this.cachedKeypair;
    };

    // Chain adapter
    ctx.chainAdapterFactory.register(new SolanaAdapter(connection));

    // Data provider (lazy with price cache)
    ctx.dataProviders.register('solana', () => {
      const inner = new SolanaDataProvider(jupiterClient, SOLANA_KNOWN_DECIMALS);
      const cached = new DataProviderWithCache(inner, ctx.coinMetadataRepo);
      return new PriceCache(cached);
    });

    // Swap builder
    ctx.actionBuilderRegistry.registerFactory(
      'solana',
      'trade:swap',
      'jupiter_swap',
      (_intent) => new SolanaSwapBuilder(jupiterClient, getKeypair, ctx.activityLog),
    );

    // Lend builders (via @jup-ag/lend SDK)
    ctx.actionBuilderRegistry.registerFactory(
      'solana',
      'lending:supply',
      'jupiter_lend',
      (_intent) => new SolanaLendSupplyBuilder(connection, ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'solana',
      'lending:withdraw',
      'jupiter_lend',
      (_intent) => new SolanaLendWithdrawBuilder(connection, ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'solana',
      'lending:borrow',
      'jupiter_lend',
      (_intent) => new SolanaLendBorrowBuilder(connection, getKeypair, ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'solana',
      'lending:repay',
      'jupiter_lend',
      (_intent) => new SolanaLendRepayBuilder(connection, ctx.activityLog),
    );

    // Perp builders (using Anchor IDL)
    const perpsProgram = createPerpetualsProgram(connection);

    ctx.actionBuilderRegistry.registerFactory(
      'solana',
      'perp:place_order',
      'jupiter_perps',
      (_intent) =>
        new SolanaPerpPlaceOrderBuilder(perpsProgram, connection, getKeypair, ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'solana',
      'perp:cancel_order',
      'jupiter_perps',
      (_intent) =>
        new SolanaPerpCancelOrderBuilder(perpsProgram, connection, getKeypair, ctx.activityLog),
    );
    // Note: perp:deposit and perp:withdraw are not registered for Solana.
    // Jupiter Perps handles collateral inline with position open/close — there's
    // no separate margin account to fund like Bluefin Pro on Sui.

    // Perp provider
    ctx.perpProviders.registerLazy('jupiter_perps', () => new JupiterPerpProvider(jupiterClient));

    // Signer + key deriver
    ctx.signerRegistry.register('solana', buildSolanaSigner);
    ctx.keyDeriverRegistry.register(new SolanaKeyDeriver());

    // MEV protector (no-op for now)
    ctx.mevProtectors.set('solana', new NoOpMevProtector());

    // Policy check: Solana-specific token address resolution
    ctx.policyRegistry.register(
      new TokenAllowlistCheck(tryResolveTokenAddress, {
        name: 'token_allowlist_solana',
        chain: 'solana',
      }),
    );

    // Market resolver for lending intent resolution
    ctx.setMarketResolver('solana', (coinType: string, explicitMarketId?: string) =>
      resolveJupiterLendMarketId(coinType, explicitMarketId),
    );
  }

  dispose(): Promise<void> {
    this.cachedKeypair = undefined;
    this.connection = undefined;
    this.jupiterClient = undefined;
    return Promise.resolve();
  }
}
