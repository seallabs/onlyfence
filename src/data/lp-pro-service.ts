/**
 * Centralized client for the LP Pro pool/coin and price APIs.
 * LP Pro Service belong to SUI chain only
 *
 * Provides `fetchCoins` (POST /pool/coins) for metadata and
 * `fetchPrices` (POST /price/prices/batch) for token prices.
 */

/**
 * Configuration for LPProService.
 */
export interface LPProServiceConfig {
  /** Base URL for the LP Pro API (e.g. https://lp-pro-api.7k.ag) */
  readonly baseUrl: string;
}

/**
 * A single coin record returned by POST /pool/coins.
 */
export interface LPProCoinRecord {
  readonly coin_type: string;
  readonly decimals: number;
  readonly name: string;
  readonly symbol: string;
  readonly verified: boolean;
  readonly no_price: boolean;
  readonly alias?: string | null;
  readonly description?: string | null;
  readonly icon_url?: string | null;
  readonly id?: string | null;
}

/**
 * A single token price returned by POST /price/prices/batch.
 */
export interface LPProTokenPrice {
  readonly token_id: string;
  readonly timestamp: number;
  readonly price: number;
}

/**
 * Centralized low-level client for the LP Pro APIs.
 *
 * - `fetchCoins` delegates to POST /pool/coins (NewCoinsRequest)
 * - `fetchPrices` delegates to POST /price/prices/batch (BatchPriceRequest)
 */
export class LPProService {
  private readonly baseUrl: string;

  constructor(config?: LPProServiceConfig) {
    this.baseUrl = config?.baseUrl ?? 'https://lp-pro-api.7k.ag';
  }

  /**
   * Fetch coin metadata from the LP Pro pool service.
   *
   * @param coinTypes - Array of on-chain coin type addresses to query
   * @returns Array of coin records returned by the API
   * @throws Error on network failure or non-OK response
   */
  async fetchCoins(coinTypes: readonly string[]): Promise<LPProCoinRecord[]> {
    return this.postJson<LPProCoinRecord[]>('/pool/coins', { coin_types: coinTypes });
  }

  /**
   * Fetch token prices in batch from the LP Pro price service.
   *
   * @param tokenIds - Array of on-chain coin type addresses
   * @param timestamp - Unix timestamp in seconds for the price snapshot (defaults to current time)
   * @returns Array of token price records
   * @throws Error on network failure or non-OK response
   */
  async fetchPrices(tokenIds: readonly string[], timestamp?: number): Promise<LPProTokenPrice[]> {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    return this.postJson<LPProTokenPrice[]>('/price/prices/batch', {
      timestamp: ts.toString(),
      token_ids: tokenIds,
    });
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `LP Pro API error (${path}): ${response.status} ${response.statusText} – ${text}`,
      );
    }

    return (await response.json()) as T;
  }
}
