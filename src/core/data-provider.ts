import type { CoinMetadataRepository, CoinMetadataRow } from '../db/coin-metadata-repo.js';
import type { Chain, ChainId } from './action-types.js';

export interface TokenMetadata {
  readonly symbol: string;
  readonly decimals: number;
  readonly address: string;
  readonly name?: string | undefined;
  readonly alias?: string | undefined;
  readonly verified?: boolean | undefined;
}

export interface DataProvider {
  readonly chainId: ChainId;
  getPrice(address: string): Promise<number>;
  getPrices(addresses: string[]): Promise<Record<string, number>>;
  getMetadata(address: string): Promise<TokenMetadata>;
  getMetadatas(addresses: string[]): Promise<Record<string, TokenMetadata>>;
}

/**
 * Factory function that creates a DataProvider for a given chain.
 * Called lazily on first access via DataProviderRegistry.
 */
export type DataProviderFactory = () => DataProvider;

/**
 * Lazy registry for DataProvider instances, keyed by chain.
 *
 * Factories are registered at bootstrap, but the actual DataProvider
 * (and its dependencies like DB repo, API client) are only created
 * when first requested via `get(chain)`.
 */
export class DataProviderRegistry {
  private readonly factories = new Map<Chain, DataProviderFactory>();
  private readonly instances = new Map<Chain, DataProvider>();

  /**
   * Register a factory for a chain. The factory is called lazily on first `get()`.
   */
  register(chain: Chain, factory: DataProviderFactory): void {
    this.factories.set(chain, factory);
  }

  /**
   * Get the DataProvider for a chain. Creates it on first access.
   *
   * @throws Error if no factory is registered for the chain
   */
  get(chain: Chain): DataProvider {
    let provider = this.instances.get(chain);
    if (provider !== undefined) return provider;

    const factory = this.factories.get(chain);
    if (factory === undefined) {
      throw new Error(`No data provider registered for chain "${chain}"`);
    }

    provider = factory();
    this.instances.set(chain, provider);
    return provider;
  }
}

/** Convert a DB row to the public TokenMetadata shape. */
function rowToMetadata(row: CoinMetadataRow): TokenMetadata {
  return {
    address: row.coin_type,
    symbol: row.symbol,
    decimals: row.decimals,
    name: row.name ?? '',
  };
}

/** Convert a TokenMetadata to a DB row. */
function metadataToRow(meta: TokenMetadata, chainId: ChainId): CoinMetadataRow {
  return {
    coin_type: meta.address,
    chain_id: chainId,
    symbol: meta.symbol,
    name: meta.name ?? null,
    decimals: meta.decimals,
  };
}

/**
 * Decorator that wraps any DataProvider with DB-backed metadata caching.
 *
 * Resolution order for metadata:
 * 1. Local DB (CoinMetadataRepository)
 * 2. Inner provider (e.g. SuiDataProvider -> LP Pro API)
 * 3. On inner success -> backfill DB for future calls
 *
 * Prices are always delegated (no caching — prices are volatile).
 * Errors from the inner provider propagate — no silent failures.
 */
export class DataProviderWithCache implements DataProvider {
  constructor(
    private readonly provider: DataProvider,
    private readonly repo: CoinMetadataRepository,
  ) {}

  get chainId(): ChainId {
    return this.provider.chainId;
  }

  async getPrice(address: string): Promise<number> {
    return this.provider.getPrice(address);
  }

  async getPrices(addresses: string[]): Promise<Record<string, number>> {
    return this.provider.getPrices(addresses);
  }

  async getMetadata(address: string): Promise<TokenMetadata> {
    // 1. Check local DB
    const cached = this.repo.get(address, this.chainId);
    if (cached !== null) {
      return rowToMetadata(cached);
    }

    // 2. Delegate to inner provider
    const meta = await this.provider.getMetadata(address);

    // 3. Backfill DB
    this.repo.upsert(metadataToRow(meta, this.chainId));

    return meta;
  }

  async getMetadatas(addresses: string[]): Promise<Record<string, TokenMetadata>> {
    if (addresses.length === 0) return {};

    // 1. Check local DB for all addresses
    const cachedRows = this.repo.getBulk(addresses, this.chainId);
    const result: Record<string, TokenMetadata> = {};
    const cachedSet = new Set<string>();

    for (const row of cachedRows) {
      result[row.coin_type] = rowToMetadata(row);
      cachedSet.add(row.coin_type);
    }

    // 2. Find uncached addresses
    const uncached = addresses.filter((a) => !cachedSet.has(a));
    if (uncached.length === 0) return result;

    // 3. Delegate uncached to inner provider
    const fetched = await this.provider.getMetadatas(uncached);

    // 4. Backfill DB and merge results
    const rows: CoinMetadataRow[] = [];
    for (const [addr, meta] of Object.entries(fetched)) {
      result[addr] = meta;
      rows.push(metadataToRow(meta, this.chainId));
    }
    this.repo.upsertBulk(rows);

    return result;
  }
}
