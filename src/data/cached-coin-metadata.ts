import type { CoinMetadata, CoinMetadataService } from './coin-metadata.js';
import type { CoinMetadataRepository, CoinMetadataRow } from '../db/coin-metadata-repo.js';

/** Map a CoinMetadata to a DB row shape. */
function toMetadataRow(meta: CoinMetadata, chainId: string): CoinMetadataRow {
  return {
    coin_type: meta.coinType,
    chain_id: chainId,
    symbol: meta.symbol,
    name: null,
    decimals: meta.decimals,
  };
}

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
    this.repo.upsert(toMetadataRow(meta, chain));

    return meta;
  }

  async prefetch(coinTypes: readonly string[], chain = 'sui'): Promise<void> {
    // 1. Find which are already cached in DB
    const cached = this.repo.getBulk(coinTypes, chain);
    const cachedSet = new Set(cached.map((r) => r.coin_type));
    const uncached = coinTypes.filter((ct) => !cachedSet.has(ct));

    if (uncached.length === 0) return;

    // 2. Delegate bulk fetch to inner service (single batched API call)
    await this.inner.prefetch(uncached, chain);

    // 3. Retrieve resolved metadata and persist to DB
    const rows: CoinMetadataRow[] = [];
    for (const coinType of uncached) {
      const meta = await this.inner.getMetadata(coinType, chain);
      rows.push(toMetadataRow(meta, chain));
    }

    this.repo.upsertBulk(rows);
  }
}
