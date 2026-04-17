import type { DataProvider, TokenMetadata } from '../../core/data-provider.js';
import { resolveSymbol } from './tokens.js';
import type { JupiterClient } from './jupiter/client.js';

/**
 * Solana implementation of DataProvider backed by Jupiter Price V2 API.
 *
 * Prices are fetched from Jupiter. Metadata uses a static known-decimals
 * map with fallback to the price API for symbol/decimals discovery.
 */
export class SolanaDataProvider implements DataProvider {
  readonly chainId = 'solana:mainnet' as const;
  private readonly knownDecimals: Readonly<Record<string, number>>;

  constructor(
    private readonly jupiterClient: JupiterClient,
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
    return this.jupiterClient.getPrices(addresses);
  }

  async getMetadata(address: string): Promise<TokenMetadata> {
    const metadatas = await this.getMetadatas([address]);
    const meta = metadatas[address];
    if (meta === undefined) {
      throw new Error(`No metadata found for "${address}"`);
    }
    return meta;
  }

  getMetadatas(addresses: string[]): Promise<Record<string, TokenMetadata>> {
    if (addresses.length === 0) return Promise.resolve({});

    const result: Record<string, TokenMetadata> = {};

    for (const addr of addresses) {
      const decimals = this.knownDecimals[addr];
      if (decimals !== undefined) {
        result[addr] = {
          address: addr,
          symbol: resolveSymbol(addr),
          decimals,
        };
      }
    }

    // For addresses not in knownDecimals, we still return what we can
    // The DataProviderWithCache wrapper will handle DB fallback
    return Promise.resolve(result);
  }
}
