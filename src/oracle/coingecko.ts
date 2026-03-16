import type { OracleClient } from './client.js';

/**
 * Maps common token symbols to CoinGecko API IDs.
 */
const TOKEN_ID_MAP: Readonly<Record<string, string>> = {
  SUI: 'sui',
  USDC: 'usd-coin',
  USDT: 'tether',
  DEEP: 'deepbook',
  BLUE: 'bluefin',
  WAL: 'walrus-2',
  ETH: 'ethereum',
  BTC: 'bitcoin',
  SOL: 'solana',
  WETH: 'weth',
  WBTC: 'wrapped-bitcoin',
};

/** Default number of retry attempts before failing */
const DEFAULT_MAX_RETRIES = 3;

/** Default delay between retries in milliseconds */
const DEFAULT_RETRY_DELAY_MS = 500;

/**
 * Configuration for the CoinGecko oracle client.
 */
export interface CoinGeckoOracleConfig {
  /** Base URL for the CoinGecko API (defaults to free tier) */
  readonly baseUrl?: string;

  /** Maximum number of retry attempts */
  readonly maxRetries?: number;

  /** Delay between retries in milliseconds */
  readonly retryDelayMs?: number;
}

/**
 * Resolve a token symbol to its CoinGecko API identifier.
 *
 * @param token - Token symbol (e.g., "SUI", "USDC")
 * @returns CoinGecko ID or the lowercase token as fallback
 */
export function resolveTokenId(token: string): string {
  const upper = token.toUpperCase();
  return TOKEN_ID_MAP[upper] ?? token.toLowerCase();
}

/**
 * Wait for a specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * CoinGecko-based implementation of the OracleClient interface.
 *
 * Fetches token prices from the CoinGecko free API with configurable
 * retry logic (default: 3 retries with 500ms delay between each).
 */
export class CoinGeckoOracle implements OracleClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(config?: CoinGeckoOracleConfig) {
    this.baseUrl = config?.baseUrl ?? 'https://api.coingecko.com/api/v3';
    this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  /**
   * Get the current USD price for a token from CoinGecko.
   *
   * Retries up to maxRetries times with retryDelayMs between each attempt.
   * If all retries fail, throws the last error encountered.
   *
   * @param token - Token symbol (e.g., "SUI", "USDC")
   * @returns USD price as a number
   * @throws Error if all retry attempts fail
   */
  async getPrice(token: string): Promise<number> {
    const coinId = resolveTokenId(token);
    const url = `${this.baseUrl}/simple/price?ids=${coinId}&vs_currencies=usd`;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(
            `CoinGecko API returned status ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as Record<string, { usd?: number } | undefined>;
        const priceData = data[coinId];

        if (!priceData?.usd) {
          throw new Error(`No USD price found for token "${token}" (CoinGecko ID: "${coinId}")`);
        }

        return priceData.usd;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.maxRetries) {
          await delay(this.retryDelayMs);
        }
      }
    }

    throw new Error(
      `Oracle failed after ${this.maxRetries} retries for token "${token}": ${lastError?.message}`,
    );
  }
}
