import type { DataProvider, TokenMetadata } from './data-provider.js';
import type { ChainId } from './action-types.js';

/**
 * Thrown when the oracle is unreachable and the cached price is stale.
 *
 * This implements fail-closed behavior: if we cannot verify the current
 * price and have no recent cache, trades requiring USD pricing are rejected.
 */
export class OracleStalePriceError extends Error {
  constructor(
    readonly address: string,
    readonly cacheAgeMs: number | undefined,
    readonly staleTtlMs: number,
  ) {
    const cacheMsg =
      cacheAgeMs !== undefined
        ? `Cache age: ${Math.round(cacheAgeMs / 1000)}s (stale after ${Math.round(staleTtlMs / 1000)}s)`
        : 'No cached price available';
    super(`Oracle unreachable for token "${address}" and price cache is stale. ${cacheMsg}`);
    this.name = 'OracleStalePriceError';
  }
}

interface CachedPrice {
  readonly price: number;
  readonly fetchedAt: number;
}

/** Default cache staleness threshold: 5 minutes. */
const DEFAULT_STALE_TTL_MS = 5 * 60 * 1000;

/**
 * Wraps a DataProvider with fail-closed price caching.
 *
 * On success: updates the in-memory cache and returns the fresh price.
 * On failure: returns the cached price if it's fresher than staleTtlMs.
 * If the cache is stale (or absent): throws OracleStalePriceError.
 *
 * All non-price methods delegate directly to the inner provider.
 */
export class PriceCache implements DataProvider {
  private readonly cache = new Map<string, CachedPrice>();

  constructor(
    private readonly inner: DataProvider,
    private readonly staleTtlMs: number = DEFAULT_STALE_TTL_MS,
  ) {}

  get chainId(): ChainId {
    return this.inner.chainId;
  }

  async getPrice(address: string): Promise<number> {
    try {
      const price = await this.inner.getPrice(address);
      this.cache.set(address, { price, fetchedAt: Date.now() });
      return price;
    } catch {
      return this.getCachedOrThrow(address);
    }
  }

  async getPrices(addresses: string[]): Promise<Record<string, number>> {
    try {
      const prices = await this.inner.getPrices(addresses);
      const now = Date.now();
      for (const [addr, price] of Object.entries(prices)) {
        this.cache.set(addr, { price, fetchedAt: now });
      }
      return prices;
    } catch {
      // Fall back to individual cached lookups
      const result: Record<string, number> = {};
      for (const addr of addresses) {
        result[addr] = this.getCachedOrThrow(addr);
      }
      return result;
    }
  }

  async getMetadata(address: string): Promise<TokenMetadata> {
    return this.inner.getMetadata(address);
  }

  async getMetadatas(addresses: string[]): Promise<Record<string, TokenMetadata>> {
    return this.inner.getMetadatas(addresses);
  }

  private getCachedOrThrow(address: string): number {
    const entry = this.cache.get(address);
    if (entry === undefined) {
      throw new OracleStalePriceError(address, undefined, this.staleTtlMs);
    }

    const ageMs = Date.now() - entry.fetchedAt;
    if (ageMs > this.staleTtlMs) {
      throw new OracleStalePriceError(address, ageMs, this.staleTtlMs);
    }

    return entry.price;
  }
}
