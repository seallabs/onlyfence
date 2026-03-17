/**
 * Service for resolving coin metadata (decimals, symbol) from remote APIs.
 *
 * Uses Noodles Finance API as the primary source with an in-memory cache.
 * Falls back to a caller-provided local decimals map for well-known tokens
 * when the API is unreachable or returns no data.
 */

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
}

/**
 * Shape of the Noodles Finance coin-detail API response.
 */
interface NoodlesCoinDetailResponse {
  readonly code: number;
  readonly data?: {
    readonly coin?: {
      readonly symbol?: string;
      readonly decimals?: number;
      readonly coin_type?: string;
    };
  };
}

/**
 * CoinMetadataService backed by the Noodles Finance API.
 *
 * Resolution order:
 * 1. In-memory cache
 * 2. Remote API call
 * 3. Hardcoded fallback (from constructor-provided known decimals)
 *
 * Errors are never silenced: if all three sources fail, the error propagates.
 */
export class NoodlesCoinMetadataService implements CoinMetadataService {
  private readonly cache = new Map<string, CoinMetadata>();
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly knownDecimals: Readonly<Record<string, number>>;

  constructor(
    apiKey: string,
    knownDecimals: Readonly<Record<string, number>> = {},
    apiBaseUrl = 'https://api.noodles.fi',
  ) {
    this.apiKey = apiKey;
    this.apiBaseUrl = apiBaseUrl;
    this.knownDecimals = knownDecimals;
  }

  async getDecimals(coinType: string, chain = 'sui'): Promise<number> {
    const meta = await this.getMetadata(coinType, chain);
    return meta.decimals;
  }

  async getMetadata(coinType: string, chain = 'sui'): Promise<CoinMetadata> {
    // 1. Check in-memory cache
    const cached = this.cache.get(coinType);
    if (cached !== undefined) return cached;

    // 2. Try remote API
    try {
      const meta = await this.fetchFromApi(coinType, chain);
      this.cache.set(coinType, meta);
      return meta;
    } catch (apiError: unknown) {
      // 3. Fallback to hardcoded known tokens
      const fallback = this.getHardcodedFallback(coinType);
      if (fallback !== undefined) {
        this.cache.set(coinType, fallback);
        return fallback;
      }

      const reason = apiError instanceof Error ? apiError.message : String(apiError);
      throw new Error(
        `Cannot resolve decimals for coin type "${coinType}": API failed (${reason}) and no local fallback`,
      );
    }
  }

  private async fetchFromApi(coinType: string, chain: string): Promise<CoinMetadata> {
    const url = new URL('/api/v1/partner/coin-detail', this.apiBaseUrl);
    url.searchParams.set('coin_id', coinType);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
        'x-chain': chain,
      },
    });

    if (!response.ok) {
      throw new Error(`Noodles API error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as NoodlesCoinDetailResponse;

    const coinDecimals = json.data?.coin?.decimals;
    if (json.code !== 200 || coinDecimals === undefined) {
      throw new Error(`Noodles API returned no data for "${coinType}"`);
    }

    return {
      coinType,
      symbol: json.data?.coin?.symbol ?? '',
      decimals: coinDecimals,
    };
  }

  private getHardcodedFallback(coinType: string): CoinMetadata | undefined {
    const decimals = this.knownDecimals[coinType];
    if (decimals === undefined) return undefined;

    // Extract symbol from coin type (last segment after ::)
    const parts = coinType.split('::');
    const symbol = parts[parts.length - 1] ?? coinType;

    return { coinType, symbol, decimals };
  }
}
