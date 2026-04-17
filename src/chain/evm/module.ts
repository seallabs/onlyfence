import { providers as ethersProviders } from 'ethers';
import { createPublicClient, http, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import type { ChainModule, ChainModuleInfo, ChainRegistrationContext } from '../chain-module.js';
import { DataProviderWithCache } from '../../core/data-provider.js';
import { NoOpMevProtector } from '../../core/mev-protector.js';
import { PriceCache } from '../../core/price-cache.js';
import { TokenAllowlistCheck } from '../../policy/checks/token-allowlist.js';
import { loadSessionKeyBytes as loadSessionKeyBytesSync } from '../../wallet/session.js';
import { EvmAdapter, EVM_CHAIN_ID } from './adapter.js';
import { AaveLendBorrowBuilder } from './aave/borrow.js';
import { createAavePool } from './aave/pool.js';
import { AaveLendRepayBuilder } from './aave/repay.js';
import { AaveLendSupplyBuilder } from './aave/supply.js';
import { AaveLendWithdrawBuilder } from './aave/withdraw.js';
import { resolveAaveV3MarketId } from './aave/markets.js';
import { EvmDataProvider } from './data-provider.js';
import { DEFAULT_EVM_CHAIN_CONFIG, EVM_MAINNET_RPC } from './defaults.js';
import { HyperliquidCancelOrderBuilder } from './hyperliquid/perp-cancel-order.js';
import { HyperliquidClient } from './hyperliquid/client.js';
import { HyperliquidPlaceOrderBuilder } from './hyperliquid/perp-place-order.js';
import { HyperliquidPerpProvider } from './hyperliquid/perp-provider.js';
import { EvmKeyDeriver } from './key-deriver.js';
import { AaveV3DataProvider } from './aave/markets.js';
import { ParaswapClient } from './paraswap/client.js';
import { ParaswapSwapBuilder } from './paraswap/swap.js';
import { buildEvmSigner } from './signer.js';
import { tryResolveTokenAddress } from './tokens.js';
import { buildEvmWalletContext, type EvmWalletContext } from './wallet.js';

/**
 * EVM (Ethereum mainnet) chain module.
 *
 * Registers the EvmAdapter, data provider, Paraswap swap builder, Aave
 * V3 lend builders, Hyperliquid perp builders/provider, key deriver,
 * signer factory, and the scoped token-allowlist policy check. New
 * protocols are added by appending a single `registerFactory` call in
 * `register()` — no changes needed elsewhere.
 */
export class EvmChainModule implements ChainModule {
  readonly info: ChainModuleInfo = {
    chain: 'ethereum',
    displayName: 'Ethereum',
    defaultRpc: EVM_MAINNET_RPC,
    defaultNetwork: 'mainnet',
    credentialRequirements: [],
    defaultChainConfig: DEFAULT_EVM_CHAIN_CONFIG,
  };

  private readonly keyDeriver = new EvmKeyDeriver();
  private cachedWallet: EvmWalletContext | undefined;
  private cachedHyperliquidClient: HyperliquidClient | undefined;
  aaveDataProvider: AaveV3DataProvider | undefined;

  createKeyDeriver(): EvmKeyDeriver {
    return this.keyDeriver;
  }

  register(ctx: ChainRegistrationContext): void {
    const rpc = ctx.config.rpc;

    const publicClient: PublicClient = createPublicClient({
      chain: mainnet,
      transport: http(rpc),
    });

    // One shared ethers provider backs both the Aave Pool service and
    // the per-wallet ethers Signer so they share a single connection
    // pool and chainId/nonce cache.
    let ethersProvider: ethersProviders.JsonRpcProvider | undefined;
    const getEthersProvider = (): ethersProviders.JsonRpcProvider => {
      ethersProvider ??= new ethersProviders.JsonRpcProvider(rpc);
      return ethersProvider;
    };

    // Paraswap SDK and Aave Pool are constructed lazily so non-EVM
    // CLI invocations don't pay for SDK initialization at startup.
    let paraswap: ParaswapClient | undefined;
    const getParaswap = (): ParaswapClient => {
      paraswap ??= new ParaswapClient();
      return paraswap;
    };

    let aavePool: ReturnType<typeof createAavePool> | undefined;
    const getAavePool = (): ReturnType<typeof createAavePool> => {
      aavePool ??= createAavePool(getEthersProvider());
      return aavePool;
    };

    const getWallet = (): EvmWalletContext => {
      if (this.cachedWallet !== undefined) return this.cachedWallet;
      const keyBytes = loadSessionKeyBytesSync(EVM_CHAIN_ID);
      this.cachedWallet = buildEvmWalletContext({
        publicClient,
        ethersProvider: getEthersProvider(),
        rpcUrl: rpc,
        keyBytes,
      });
      return this.cachedWallet;
    };

    const getHyperliquidClient = (): HyperliquidClient => {
      if (this.cachedHyperliquidClient !== undefined) return this.cachedHyperliquidClient;
      const keyBytes = loadSessionKeyBytesSync(EVM_CHAIN_ID);
      this.cachedHyperliquidClient = new HyperliquidClient(keyBytes);
      return this.cachedHyperliquidClient;
    };

    this.aaveDataProvider = new AaveV3DataProvider(getEthersProvider());

    ctx.chainAdapterFactory.register(new EvmAdapter(publicClient));

    ctx.dataProviders.register('ethereum', () => {
      const inner = new EvmDataProvider();
      const cached = new DataProviderWithCache(inner, ctx.coinMetadataRepo);
      return new PriceCache(cached);
    });

    // Registry factory callbacks run only when a builder is first
    // resolved, so `getParaswap()` / `getAavePool()` stay deferred.
    ctx.actionBuilderRegistry.registerFactory(
      'ethereum',
      'trade:swap',
      'paraswap',
      (_intent) => new ParaswapSwapBuilder(getParaswap(), getWallet, ctx.activityLog),
    );

    ctx.actionBuilderRegistry.registerFactory(
      'ethereum',
      'lending:supply',
      'aave_v3',
      (_intent) => new AaveLendSupplyBuilder(getAavePool(), getWallet, ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'ethereum',
      'lending:withdraw',
      'aave_v3',
      (_intent) => new AaveLendWithdrawBuilder(getAavePool(), getWallet, ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'ethereum',
      'lending:borrow',
      'aave_v3',
      (_intent) => new AaveLendBorrowBuilder(getAavePool(), getWallet, ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'ethereum',
      'lending:repay',
      'aave_v3',
      (_intent) => new AaveLendRepayBuilder(getAavePool(), getWallet, ctx.activityLog),
    );

    ctx.actionBuilderRegistry.registerFactory(
      'ethereum',
      'perp:place_order',
      'hyperliquid',
      (_intent) => new HyperliquidPlaceOrderBuilder(getHyperliquidClient, ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'ethereum',
      'perp:cancel_order',
      'hyperliquid',
      (_intent) => new HyperliquidCancelOrderBuilder(getHyperliquidClient, ctx.activityLog),
    );

    ctx.perpProviders.registerLazy(
      'hyperliquid',
      () => new HyperliquidPerpProvider(getHyperliquidClient),
    );

    ctx.signerRegistry.register('ethereum', buildEvmSigner);
    ctx.keyDeriverRegistry.register(this.keyDeriver);

    ctx.mevProtectors.set('ethereum', new NoOpMevProtector());

    ctx.policyRegistry.register(
      new TokenAllowlistCheck(tryResolveTokenAddress, {
        name: 'token_allowlist_ethereum',
        chain: 'ethereum',
      }),
    );

    ctx.setMarketResolver('ethereum', (coinType: string, explicitMarketId?: string) =>
      resolveAaveV3MarketId(coinType, explicitMarketId),
    );
  }

  async dispose(): Promise<void> {
    if (this.cachedHyperliquidClient !== undefined) {
      await this.cachedHyperliquidClient.dispose();
      this.cachedHyperliquidClient = undefined;
    }
    this.cachedWallet = undefined;
  }
}
