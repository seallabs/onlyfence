# Trade USD Recording & Coin Metadata DB Cache

**Date:** 2026-03-17
**Status:** Approved
**Scope:** (1) Thread `tradeValueUsd` into trade log so `value_usd` is populated. (2) Add a `coin_metadata` DB table as a local cache layer in front of the Noodles API.

## Problem

1. **value_usd is always NULL** — `swap.ts` computes `tradeValueUsd` from the oracle and passes it into `PolicyContext`, but `executePipeline` never forwards it to `buildTradeRecord` / `logTrade`. Every trade row has `value_usd = NULL`, making the 24h rolling volume always 0 and the dashboard volume bar useless.

2. **Coin metadata is re-fetched every invocation** — `NoodlesCoinMetadataService` uses an in-memory cache that resets per process. Every CLI call hits the Noodles API for decimals even for previously-seen coins. This adds latency and wastes API quota.

## Decisions

| Decision | Choice |
|----------|--------|
| How to pass value_usd | Add `tradeValueUsd?: number` to `PipelineInput`; thread into `buildTradeRecord` |
| Coin metadata cache layer | Decorator pattern: `CachedCoinMetadataService` wraps `NoodlesCoinMetadataService` |
| DB table primary key | Composite `(coin_type, chain)` |
| Cache invalidation | None for MVP — metadata (decimals, symbol) is immutable on-chain |
| `name` field | Optional (`TEXT` nullable) — DB-only for future text search; not added to `CoinMetadata` interface yet |

## Feature 1: Thread `tradeValueUsd` into Trade Log

### Changes

**`src/core/transaction-pipeline.ts`**

Add `tradeValueUsd` to `PipelineInput`:

```typescript
export interface PipelineInput {
  // ... existing fields ...
  readonly tradeValueUsd?: number;
}
```

Update `buildTradeRecord` to accept and pass `value_usd`:

```typescript
function buildTradeRecord(
  intent: ActionIntent,
  decision: 'approved' | 'rejected',
  opts?: {
    // ... existing fields ...
    readonly valueUsd?: number;
  },
): TradeRecord {
  // ...
  return {
    // ...
    ...(opts?.valueUsd !== undefined ? { value_usd: opts.valueUsd } : {}),
  };
}
```

Thread `input.tradeValueUsd` into all three `logTrade` call sites:
- Rejection (step 2)
- Watch-only simulation (step 7)
- Success (step 10)

Note: the `simulation_failed` path (step 6) does NOT log a trade — this is intentional since no action was attempted.

**`src/cli/commands/swap.ts`**

Pass `tradeValueUsd` when calling `executePipeline`:

```typescript
const result = await executePipeline({
  // ... existing fields ...
  tradeValueUsd,
});
```

Also add `tradeValueUsd` to `PipelineResult` so `mapPipelineResultToOutput` can populate `SuccessResponse.valueUsd` (currently hardcoded to `null`).

No changes needed to `PolicyContext`, `TradeRecord`, `TradeLog`, or DB schema — the `value_usd` column already exists and `TradeRecord` already has the `value_usd` field. We're just finally populating it.

## Feature 2: Coin Metadata DB Cache

### DB Schema

New table added via idempotent migration in `src/db/migrations.ts`:

```sql
CREATE TABLE IF NOT EXISTS coin_metadata (
  coin_type   TEXT    NOT NULL,
  chain       TEXT    NOT NULL,
  symbol      TEXT    NOT NULL,
  name        TEXT,
  decimals    INTEGER NOT NULL,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (coin_type, chain)
);
```

### New File: `src/db/coin-metadata-repo.ts`

Repository for the `coin_metadata` table. Follows the same cached-prepared-statement pattern as `TradeLog`.

```typescript
export interface CoinMetadataRow {
  readonly coin_type: string;
  readonly chain: string;
  readonly symbol: string;
  readonly name: string | null;
  readonly decimals: number;
}

export class CoinMetadataRepository {
  constructor(db: Database.Database);
  get(coinType: string, chain: string): CoinMetadataRow | null;
  getBulk(coinTypes: readonly string[], chain: string): CoinMetadataRow[];
  upsert(row: CoinMetadataRow): void;
  upsertBulk(rows: readonly CoinMetadataRow[]): void;
}
```

- `get`: single lookup by PK
- `getBulk`: `WHERE coin_type IN (...)` — uses dynamic SQL since `better-sqlite3` doesn't support array binds
- `upsert`: `INSERT OR REPLACE` — safe because metadata is immutable on-chain
- `upsertBulk`: wraps multiple upserts in a transaction

### New File: `src/data/cached-coin-metadata.ts`

Decorator that wraps any `CoinMetadataService` with DB-backed persistence.

```typescript
export class CachedCoinMetadataService implements CoinMetadataService {
  constructor(
    private readonly repo: CoinMetadataRepository,
    private readonly inner: CoinMetadataService,
  );

  async getDecimals(coinType: string, chain: string): Promise<number>;
  async getMetadata(coinType: string, chain: string): Promise<CoinMetadata>;
  async prefetch(coinTypes: readonly string[], chain?: string): Promise<void>;
}
```

**Resolution order for `getMetadata`:**
1. Query `CoinMetadataRepository.get(coinType, chain)`
2. If found → return (no API call)
3. If not found → delegate to `inner.getMetadata(coinType, chain)`
4. On success → `repo.upsert(result)` to persist for future calls
5. Return result (errors propagate — no silent failures)

**Resolution order for `prefetch`:**
1. Query `repo.getBulk(coinTypes, chain)` to find already-cached
2. Filter to uncached coin types
3. If all cached → return early
4. Call `inner.getMetadata(coinType, chain)` for each uncached type (this triggers the Noodles API call and returns the full `CoinMetadata` result directly)
5. `repo.upsertBulk(results)` to persist all fetched metadata

Note: we call `getMetadata` individually rather than `prefetch` because the inner service's `prefetch` returns `void` — it only warms the in-memory cache. Calling `getMetadata` gives us the data we need to persist to the DB in one step.

### Bootstrap Wiring

**`src/cli/bootstrap.ts`**

```typescript
import { CoinMetadataRepository } from '../db/coin-metadata-repo.js';
import { CachedCoinMetadataService } from '../data/cached-coin-metadata.js';

export function buildCoinMetadataService(db: Database.Database): CoinMetadataService {
  const apiKey = process.env['NOODLES_API_KEY'];
  const inner = new NoodlesCoinMetadataService(SUI_KNOWN_DECIMALS, apiKey);
  const repo = new CoinMetadataRepository(db);
  return new CachedCoinMetadataService(repo, inner);
}
```

Note: `buildCoinMetadataService` replaces `_logger: Logger` with `db: Database.Database`. Update call site in `bootstrap()` accordingly.

### Data Flow Diagram

```
CLI: coinMetadataService.getDecimals("0xabc::coin::COIN", "sui")
  │
  ▼
CachedCoinMetadataService.getMetadata()
  │
  ├─ [1] repo.get("0xabc::coin::COIN", "sui")
  │      ├─ HIT  → return { coinType, symbol, decimals }
  │      └─ MISS → continue
  │
  ├─ [2] inner.getMetadata("0xabc::coin::COIN", "sui")
  │      ├─ NoodlesCoinMetadataService in-memory cache
  │      ├─ Noodles API POST /api/v1/partner/coin-list
  │      └─ Hardcoded SUI_KNOWN_DECIMALS fallback
  │
  ├─ [3] repo.upsert({ coin_type, chain, symbol, name: null, decimals })
  │
  └─ return result
```

## Files Changed

| File | Change |
|------|--------|
| `src/core/transaction-pipeline.ts` | Add `tradeValueUsd` to `PipelineInput`, thread into `buildTradeRecord` |
| `src/cli/commands/swap.ts` | Pass `tradeValueUsd` to `executePipeline` |
| `src/db/migrations.ts` | Add `coin_metadata` table creation |
| `src/db/coin-metadata-repo.ts` | **New** — `CoinMetadataRepository` |
| `src/data/cached-coin-metadata.ts` | **New** — `CachedCoinMetadataService` decorator |
| `src/cli/bootstrap.ts` | Wire `CachedCoinMetadataService` with DB, update `buildCoinMetadataService` signature |

## Testing

- Unit test `CoinMetadataRepository`: insert, get, getBulk, upsert idempotency
- Unit test `CachedCoinMetadataService`: DB hit skips inner, DB miss delegates and backfills
- Integration: verify `value_usd` is populated in trade rows after a swap
- Verify existing `NoodlesCoinMetadataService` tests still pass (no changes to it)
