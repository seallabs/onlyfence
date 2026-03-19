import { getUserPositionCapId, type AlphalendClient } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';

interface BuildContext {
  markets: Awaited<ReturnType<AlphalendClient['getMarketsChain']>>;
  portfolio: NonNullable<Awaited<ReturnType<AlphalendClient['getUserPortfolioFromPositionCapId']>>>;
  priceUpdateCoinTypes: Set<string>;
  positionCapId: string;
}

export class AlphaLendBase {
  constructor(
    protected readonly alphalendClient: AlphalendClient,
    protected readonly suiClient: SuiClient,
  ) {}

  async getBuildContext(
    network: string,
    address: string,
    coinType?: string,
  ): Promise<BuildContext> {
    const markets = await this.alphalendClient.getMarketsChain();
    if (markets === undefined || markets.length === 0) {
      throw new Error('No markets found.');
    }
    const marketMap = new Map(markets.map((m) => [+m.market.id, m]));
    const positionCapId = await getUserPositionCapId(this.suiClient, network, address);
    if (positionCapId === undefined) {
      throw new Error('No position found. Supply collateral first.');
    }
    const portfolio = await this.alphalendClient.getUserPortfolioFromPositionCapId(positionCapId);
    if (portfolio === undefined) {
      throw new Error('No position found. Supply collateral first.');
    }

    const priceUpdateCoinTypes = new Set<string>(
      coinType !== undefined && coinType !== '' ? [coinType] : [],
    );
    portfolio.borrowedAmounts.forEach((_v, k) => {
      const market = marketMap.get(k);
      if (market !== undefined) {
        priceUpdateCoinTypes.add(market.market.coinType);
      }
    });
    portfolio.suppliedAmounts.forEach((_v, k) => {
      const market = marketMap.get(k);
      if (market !== undefined) {
        priceUpdateCoinTypes.add(market.market.coinType);
      }
    });

    return {
      markets,
      portfolio,
      priceUpdateCoinTypes,
      positionCapId,
    };
  }
}
