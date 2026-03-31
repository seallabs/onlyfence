import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { ChainModule, ChainModuleInfo, ChainRegistrationContext } from '../chain-module.js';
import { DataProviderWithCache } from '../../core/data-provider.js';
import { NoOpMevProtector } from '../../core/mev-protector.js';
import { PriceCache } from '../../core/price-cache.js';
import { TokenAllowlistCheck } from '../../policy/checks/token-allowlist.js';
import { loadSessionKeyBytes as loadSessionKeyBytesSync } from '../../wallet/session.js';
import { SuiSwapBuilder } from './7k/swap.js';
import { SuiAdapter } from './adapter.js';
import { AlphaLendBorrowBuilder } from './alphalend/borrow.js';
import { AlphaLendClaimRewardsBuilder } from './alphalend/claim-rewards.js';
import { createAlphaLendClient } from './alphalend/client.js';
import { resolveMarketId } from './alphalend/markets.js';
import { AlphaLendRepayBuilder } from './alphalend/repay.js';
import { AlphaLendSupplyBuilder } from './alphalend/supply.js';
import { AlphaLendWithdrawBuilder } from './alphalend/withdraw.js';
import { BluefinCancelOrderBuilder } from './bluefin-pro/cancel-order.js';
import { BluefinClient } from './bluefin-pro/client.js';
import { BluefinDepositBuilder } from './bluefin-pro/deposit.js';
import { BluefinPlaceOrderBuilder } from './bluefin-pro/place-order.js';
import { BluefinPerpProvider } from './bluefin-pro/provider.js';
import { BluefinWithdrawBuilder } from './bluefin-pro/withdraw.js';
import { SuiDataProvider } from './data-provider.js';
import { DEFAULT_SUI_CHAIN_CONFIG, SUI_MAINNET_RPC } from './defaults.js';
import { SuiKeyDeriver } from './key-deriver.js';
import { buildSuiSigner } from './signer.js';
import { SUI_KNOWN_DECIMALS, tryResolveTokenAddress } from './tokens.js';

/**
 * Sui chain module — registers all Sui-specific components.
 *
 * Encapsulates: SuiAdapter, SuiDataProvider, AlphaLend builders,
 * Bluefin perp builders/provider, key deriver, signer factory,
 * and MEV protector.
 */
export class SuiChainModule implements ChainModule {
  readonly info: ChainModuleInfo = {
    chain: 'sui',
    displayName: 'Sui',
    defaultRpc: SUI_MAINNET_RPC,
    defaultNetwork: 'mainnet',
    credentialRequirements: [],
    defaultChainConfig: DEFAULT_SUI_CHAIN_CONFIG,
  };

  /** AlphaLend client, available after register(). Used by lend query commands. */
  alphalendClient: AlphalendClient | undefined;

  createKeyDeriver(): SuiKeyDeriver {
    return new SuiKeyDeriver();
  }

  private cachedBluefinClient: BluefinClient | undefined;
  private chainId: string | undefined;

  register(ctx: ChainRegistrationContext): void {
    const rpc = ctx.config.rpc;
    const network = (ctx.config.network ?? 'mainnet') as 'mainnet' | 'testnet';
    this.chainId = `sui:${network}`;

    const suiClient = new SuiJsonRpcClient({ url: rpc, network });

    // Chain adapter
    ctx.chainAdapterFactory.register(new SuiAdapter(suiClient));

    // Data provider (lazy with price cache)
    ctx.dataProviders.register('sui', () => {
      const inner = new SuiDataProvider(ctx.lpPro, SUI_KNOWN_DECIMALS);
      const cached = new DataProviderWithCache(inner, ctx.coinMetadataRepo);
      return new PriceCache(cached);
    });

    // AlphaLend client + builders
    const alphalendClient = createAlphaLendClient(suiClient, network);
    this.alphalendClient = alphalendClient;

    ctx.actionBuilderRegistry.registerFactory('sui', 'trade:swap', '7k', (intent) => {
      const slippageBps = intent.action === 'trade:swap' ? intent.params.slippageBps : 100;
      return new SuiSwapBuilder(ctx.activityLog, slippageBps);
    });

    ctx.actionBuilderRegistry.registerFactory(
      'sui',
      'lending:supply',
      'alphalend',
      (_intent) => new AlphaLendSupplyBuilder(alphalendClient, suiClient, ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'sui',
      'lending:borrow',
      'alphalend',
      (_intent) => new AlphaLendBorrowBuilder(alphalendClient, suiClient, ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'sui',
      'lending:withdraw',
      'alphalend',
      (_intent) => new AlphaLendWithdrawBuilder(alphalendClient, suiClient, ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'sui',
      'lending:repay',
      'alphalend',
      (_intent) => new AlphaLendRepayBuilder(alphalendClient, suiClient, ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'sui',
      'lending:claim_rewards',
      'alphalend',
      (_intent) => new AlphaLendClaimRewardsBuilder(alphalendClient, suiClient, ctx.activityLog),
    );

    // Bluefin perp builders + provider (lazy — created on first access)
    const getBluefinClient = (): BluefinClient => {
      if (this.cachedBluefinClient !== undefined) return this.cachedBluefinClient;

      const chainIdForSession = this.chainId ?? 'sui:mainnet';
      const keyBytes = loadSessionKeyBytesSync(chainIdForSession);
      const seed = keyBytes.length === 64 ? keyBytes.subarray(0, 32) : keyBytes;
      const keypair = Ed25519Keypair.fromSecretKey(seed);

      this.cachedBluefinClient = new BluefinClient({
        network: network === 'mainnet' ? 'mainnet' : 'testnet',
        suiClient,
        keypair,
      });
      return this.cachedBluefinClient;
    };

    ctx.actionBuilderRegistry.registerFactory(
      'sui',
      'perp:place_order',
      'bluefin_pro',
      (_intent) => new BluefinPlaceOrderBuilder(getBluefinClient(), ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'sui',
      'perp:cancel_order',
      'bluefin_pro',
      (_intent) => new BluefinCancelOrderBuilder(getBluefinClient(), ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'sui',
      'perp:deposit',
      'bluefin_pro',
      (_intent) => new BluefinDepositBuilder(getBluefinClient(), ctx.activityLog),
    );
    ctx.actionBuilderRegistry.registerFactory(
      'sui',
      'perp:withdraw',
      'bluefin_pro',
      (_intent) => new BluefinWithdrawBuilder(getBluefinClient(), ctx.activityLog),
    );

    ctx.perpProviders.registerLazy(
      'bluefin_pro',
      () => new BluefinPerpProvider(getBluefinClient()),
    );

    // Signer + key deriver
    ctx.signerRegistry.register('sui', buildSuiSigner);
    ctx.keyDeriverRegistry.register(new SuiKeyDeriver());

    // MEV protector (no-op for now)
    ctx.mevProtectors.set('sui', new NoOpMevProtector());

    // Policy check: Sui-specific token address resolution
    ctx.policyRegistry.register(new TokenAllowlistCheck(tryResolveTokenAddress));

    // Market resolver for lending intent resolution
    ctx.setMarketResolver((coinType: string, explicitMarketId?: string) =>
      resolveMarketId(alphalendClient, coinType, explicitMarketId),
    );
  }

  async dispose(): Promise<void> {
    if (this.cachedBluefinClient !== undefined) {
      await this.cachedBluefinClient.dispose();
      this.cachedBluefinClient = undefined;
    }
  }
}
