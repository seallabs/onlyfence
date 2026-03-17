import type { CoinMetadata, CoinMetadataService } from './coin-metadata.js';
import type { CoinMetadataRepository } from '../db/coin-metadata-repo.js';

/**
 * Decorator that wraps any CoinMetadataService with DB-backed persistence.
 *
 * Resolution order:
 * 1. Local DB (CoinMetadataRepository)
 * 2. Inner service (e.g. NoodlesCoinMetadataService -> Noodles API)
 * 3. On inner success -> backfill DB for future calls
 *
 * Errors from the inner service propagate — no silent failures.
 */
export class CachedCoinMetadataService implements CoinMetadataService {
  constructor(
    private readonly repo: CoinMetadataRepository,
    private readonly inner: CoinMetadataService,
  ) {}

  async getDecimals(coinType: string, chain: string): Promise<number> {
    const meta = await this.getMetadata(coinType, chain);
    return meta.decimals;
  }

  async getMetadata(coinType: string, chain: string): Promise<CoinMetadata> {
    // 1. Check local DB
    const cached = this.repo.get(coinType, chain);
    if (cached !== null) {
      return {
        coinType: cached.coin_type,
        symbol: cached.symbol,
        decimals: cached.decimals,
      };
    }

    // 2. Delegate to inner service
    const meta = await this.inner.getMetadata(coinType, chain);

    // 3. Backfill DB
    this.repo.upsert({
      coin_type: meta.coinType,
      chain,
      symbol: meta.symbol,
      name: null,
      decimals: meta.decimals,
    });

    return meta;
  }

  async prefetch(coinTypes: readonly string[], chain = 'sui'): Promise<void> {
    // 1. Find which are already cached
    const cached = this.repo.getBulk(coinTypes, chain);
    const cachedSet = new Set(cached.map((r) => r.coin_type));
    const uncached = coinTypes.filter((ct) => !cachedSet.has(ct));

    if (uncached.length === 0) return;

    // 2. Fetch uncached individually (getMetadata returns data directly)
    const results: CoinMetadata[] = [];
    for (const coinType of uncached) {
      const meta = await this.inner.getMetadata(coinType, chain);
      results.push(meta);
    }

    // 3. Persist to DB
    this.repo.upsertBulk(
      results.map((m) => ({
        coin_type: m.coinType,
        chain,
        symbol: m.symbol,
        name: null,
        decimals: m.decimals,
      })),
    );
  }
}
