/**
 * Service for resolving coin metadata (decimals, symbol) from remote APIs.
 *
 * Uses Noodles Finance bulk coin-list API as the primary source with an in-memory cache.
 * Falls back to a caller-provided local decimals map for well-known tokens
 * when the API is unreachable or returns no data.
 */

import { resolveSymbol } from '../chain/sui/tokens.js';
import { toErrorMessage } from '../utils/index.js';

/**
 * Immutable metadata for a single coin type.
 */
export interface CoinMetadata {
  readonly coinType: string;
  readonly symbol: string;
  readonly decimals: number;
}

/**
 * Contract for resolving coin metadata (decimals, symbol).
 * Implementations may use remote APIs, local caches, or both.
 */
export interface CoinMetadataService {
  getDecimals(coinType: string, chain: string): Promise<number>;
  getMetadata(coinType: string, chain: string): Promise<CoinMetadata>;
  prefetch(coinTypes: readonly string[], chain?: string): Promise<void>;
}

/**
 * Shape of the Noodles Finance coin-list API response.
 */
interface NoodlesCoinListResponse {
  readonly code: number;
  readonly data?: readonly {
    readonly coin_type: string;
    readonly symbol?: string;
    readonly decimals: number;
  }[];
}

/**
 * CoinMetadataService backed by the Noodles Finance bulk coin-list API.
 *
 * Resolution order:
 * 1. In-memory cache
 * 2. Remote API call (bulk coin-list endpoint)
 * 3. Hardcoded fallback (from constructor-provided known decimals)
 *
 * Errors are never silenced: if all three sources fail, the error propagates.
 */
export class NoodlesCoinMetadataService implements CoinMetadataService {
  private readonly cache = new Map<string, CoinMetadata>();
  private readonly apiBaseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly knownDecimals: Readonly<Record<string, number>>;

  constructor(
    knownDecimals: Readonly<Record<string, number>> = {},
    apiKey?: string,
    apiBaseUrl = 'https://api.noodles.fi',
  ) {
    this.knownDecimals = knownDecimals;
    this.apiKey = apiKey;
    this.apiBaseUrl = apiBaseUrl;
  }

  async getDecimals(coinType: string, chain = 'sui'): Promise<number> {
    const meta = await this.getMetadata(coinType, chain);
    return meta.decimals;
  }

  async getMetadata(coinType: string, chain = 'sui'): Promise<CoinMetadata> {
    // 1. Check in-memory cache
    const cached = this.cache.get(coinType);
    if (cached !== undefined) return cached;

    // 2. Try remote API (bulk endpoint with single coin)
    try {
      const results = await this.fetchBulk([coinType], chain);
      const meta = results.find((r) => r.coinType === coinType);
      if (meta === undefined) {
        throw new Error(`Noodles API returned no data for "${coinType}"`);
      }
      this.cache.set(coinType, meta);
      return meta;
    } catch (apiError: unknown) {
      // 3. Fallback to hardcoded known tokens
      const fallback = this.getHardcodedFallback(coinType);
      if (fallback !== undefined) {
        this.cache.set(coinType, fallback);
        return fallback;
      }

      throw new Error(
        `Cannot resolve decimals for coin type "${coinType}": API failed (${toErrorMessage(apiError)}) and no local fallback`,
      );
    }
  }

  async prefetch(coinTypes: readonly string[], chain = 'sui'): Promise<void> {
    // Filter out already-cached types
    const uncached = coinTypes.filter((ct) => !this.cache.has(ct));
    if (uncached.length === 0) return;

    const results = await this.fetchBulk(uncached, chain);
    for (const meta of results) {
      this.cache.set(meta.coinType, meta);
    }
  }

  private async fetchBulk(coinTypes: readonly string[], chain: string): Promise<CoinMetadata[]> {
    const url = `${this.apiBaseUrl}/api/v1/partner/coin-list`;

    const headers: Record<string, string> = {
      'x-chain': chain,
      'Content-Type': 'application/json',
    };
    if (this.apiKey !== undefined && this.apiKey !== '') {
      headers['x-api-key'] = this.apiKey;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        pagination: { limit: coinTypes.length, offset: 0 },
        filters: { coin_ids: coinTypes },
      }),
    });

    if (!response.ok) {
      throw new Error(`Noodles API error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as NoodlesCoinListResponse;
    const items = json.data;
    if (json.code !== 200 || items === undefined) {
      throw new Error('Noodles API returned unexpected response');
    }

    return items
      .filter((c) => typeof c.decimals === 'number')
      .map((c) => ({
        coinType: c.coin_type,
        symbol: c.symbol ?? '',
        decimals: c.decimals,
      }));
  }

  private getHardcodedFallback(coinType: string): CoinMetadata | undefined {
    const decimals = this.knownDecimals[coinType];
    if (decimals === undefined) return undefined;

    return { coinType, symbol: resolveSymbol(coinType), decimals };
  }
}
