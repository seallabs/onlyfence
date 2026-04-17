import type { DataProvider, TokenMetadata } from '../../core/data-provider.js';
import { EVM_CHAIN_ID } from './adapter.js';
import { EVM_KNOWN_DECIMALS, isNativeEth, resolveSymbol } from './tokens.js';

/** DeFi Llama free token price API — no key, no hard rate limits. */
const DEFILLAMA_PRICES_URL = 'https://coins.llama.fi/prices/current';

/** DeFi Llama uses this identifier for native ETH on the Ethereum chain. */
const DEFILLAMA_ETH_ID = 'coingecko:ethereum';

interface DefiLlamaPriceResponse {
  readonly coins: Record<
    string,
    {
      readonly decimals?: number;
      readonly symbol?: string;
      readonly price?: number;
      readonly timestamp?: number;
      readonly confidence?: number;
    }
  >;
}

/**
 * EVM implementation of DataProvider backed by DeFi Llama's free prices API.
 *
 * Native ETH is queried via `coingecko:ethereum` since DeFi Llama does not
 * index the sentinel `0xEeeeeEe...` address; ERC-20 tokens are queried by
 * `ethereum:<lowercased address>`. Metadata is sourced from the static
 * token registry and caller-supplied unknowns are silently dropped — the
 * `DataProviderWithCache` layer handles DB fallback.
 */
export class EvmDataProvider implements DataProvider {
  readonly chainId = EVM_CHAIN_ID;

  async getPrice(address: string): Promise<number> {
    const prices = await this.getPrices([address]);
    const price = prices[address];
    if (price === undefined) {
      throw new Error(`No USD price found for EVM token "${address}"`);
    }
    return price;
  }

  async getPrices(addresses: string[]): Promise<Record<string, number>> {
    if (addresses.length === 0) return {};

    // Reverse map so the response can be re-keyed under the caller's
    // original address (preserving case).
    const idToCallerAddress = new Map<string, string>();
    const ids: string[] = [];
    for (const addr of addresses) {
      const id = toDefiLlamaId(addr);
      idToCallerAddress.set(id, addr);
      ids.push(id);
    }

    const url = `${DEFILLAMA_PRICES_URL}/${ids.join(',')}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`DeFi Llama price API error (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as DefiLlamaPriceResponse;

    const result: Record<string, number> = {};
    for (const [id, entry] of Object.entries(data.coins)) {
      if (entry.price === undefined || !Number.isFinite(entry.price)) continue;
      const callerAddress = idToCallerAddress.get(id);
      if (callerAddress === undefined) continue;
      result[callerAddress] = entry.price;
    }
    return result;
  }

  async getMetadata(address: string): Promise<TokenMetadata> {
    const metadatas = await this.getMetadatas([address]);
    const meta = metadatas[address];
    if (meta === undefined) {
      throw new Error(`No metadata found for EVM token "${address}"`);
    }
    return meta;
  }

  getMetadatas(addresses: string[]): Promise<Record<string, TokenMetadata>> {
    if (addresses.length === 0) return Promise.resolve({});

    const result: Record<string, TokenMetadata> = {};
    for (const addr of addresses) {
      const normalized = addr.toLowerCase();
      const decimals = EVM_KNOWN_DECIMALS[normalized];
      if (decimals !== undefined) {
        result[addr] = {
          address: normalized,
          symbol: resolveSymbol(addr),
          decimals,
        };
      }
    }
    return Promise.resolve(result);
  }
}

function toDefiLlamaId(address: string): string {
  if (isNativeEth(address)) return DEFILLAMA_ETH_ID;
  return `ethereum:${address.toLowerCase()}`;
}
