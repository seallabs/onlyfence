import type { DataProvider, TokenMetadata } from '../../core/data-provider.js';
import type { LPProService } from '../../data/lp-pro-service.js';
import { resolveSymbol } from './tokens.js';

/**
 * Sui implementation of DataProvider backed by LPProService.
 *
 * Delegates metadata queries to POST /pool/coins and price queries
 * to POST /price/prices/batch.
 *
 * All addresses MUST be normalized (via `normalizeStructTag`) before
 * reaching this provider. Normalization is the caller's responsibility
 * — enforced at the CLI command boundary in `resolveTokenInput()`.
 *
 * Metadata queries fall back to a caller-provided known-decimals map
 * when the API is unreachable, ensuring well-known tokens like SUI
 * and USDC work even on cold starts without network.
 */
export class SuiDataProvider implements DataProvider {
  readonly chain = 'sui' as const;
  private readonly knownDecimals: Readonly<Record<string, number>>;

  constructor(
    private readonly lpPro: LPProService,
    knownDecimals: Readonly<Record<string, number>> = {},
  ) {
    this.knownDecimals = knownDecimals;
  }

  async getPrice(address: string): Promise<number> {
    const prices = await this.getPrices([address]);
    const price = prices[address];
    if (price === undefined) {
      throw new Error(`No USD price found for "${address}"`);
    }
    return price;
  }

  async getPrices(addresses: string[]): Promise<Record<string, number>> {
    if (addresses.length === 0) return {};

    const tokenPrices = await this.lpPro.fetchPrices(addresses);
    const result: Record<string, number> = {};
    for (const tp of tokenPrices) {
      result[tp.token_id] = tp.price;
    }
    return result;
  }

  async getMetadata(address: string): Promise<TokenMetadata> {
    const metadatas = await this.getMetadatas([address]);
    const meta = metadatas[address];
    if (meta === undefined) {
      throw new Error(`No metadata found for "${address}"`);
    }
    return meta;
  }

  async getMetadatas(addresses: string[]): Promise<Record<string, TokenMetadata>> {
    if (addresses.length === 0) return {};

    try {
      const coins = await this.lpPro.fetchCoins(addresses);
      const result: Record<string, TokenMetadata> = {};
      for (const coin of coins) {
        result[coin.coin_type] = {
          address: coin.coin_type,
          symbol: coin.symbol,
          decimals: coin.decimals,
        };
      }

      this.fillFallbacks(addresses, result);
      return result;
    } catch {
      const result: Record<string, TokenMetadata> = {};
      this.fillFallbacks(addresses, result);

      if (Object.keys(result).length === 0) {
        throw new Error(`LP Pro API unreachable and no local fallback for requested tokens`);
      }

      return result;
    }
  }

  private fillFallbacks(addresses: string[], result: Record<string, TokenMetadata>): void {
    for (const addr of addresses) {
      if (result[addr] === undefined) {
        const decimals = this.knownDecimals[addr];
        if (decimals !== undefined) {
          result[addr] = { address: addr, symbol: resolveSymbol(addr), decimals };
        }
      }
    }
  }
}
