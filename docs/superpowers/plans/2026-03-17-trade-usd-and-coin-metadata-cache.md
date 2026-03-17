# Trade USD Recording & Coin Metadata DB Cache — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `value_usd` in trade logs (currently always NULL) and add a SQLite cache for coin metadata to avoid re-fetching from Noodles API every CLI invocation.

**Architecture:** Feature 1 threads the existing `tradeValueUsd` through `PipelineInput` into `buildTradeRecord` at all three `logTrade` call sites. Feature 2 adds a `coin_metadata` table and a `CachedCoinMetadataService` decorator that checks the DB before delegating to the existing `NoodlesCoinMetadataService`.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, Ink (TUI)

**Spec:** `docs/superpowers/specs/2026-03-17-trade-usd-and-coin-metadata-cache-design.md`

---

### Task 1: Thread `tradeValueUsd` into Pipeline and Trade Log

**Files:**
- Modify: `src/core/transaction-pipeline.ts` (PipelineInput, buildTradeRecord, executePipeline)
- Modify: `src/core/action-types.ts` (PipelineResult)
- Modify: `src/cli/commands/swap.ts` (pass tradeValueUsd, populate SuccessResponse.valueUsd)
- Test: `src/__tests__/transaction-pipeline.test.ts`

- [ ] **Step 1: Write failing tests for value_usd in trade log**

Add to `src/__tests__/transaction-pipeline.test.ts`:

```typescript
it('records value_usd in trade log on success', async () => {
  const intent = createSwapIntent();
  const builder = createMockBuilder();
  const chainAdapter = createMockChainAdapter();
  const signer = createMockSigner();
  const mevProtector = new NoOpMevProtector();

  const input: PipelineInput = {
    intent,
    builder,
    chainAdapter,
    policyRegistry,
    policyContext,
    mevProtector,
    tradeLog,
    logger,
    signer,
    watchOnly: false,
    tradeValueUsd: 42.5,
  };

  await executePipeline(input);

  const trades = tradeLog.getRecentTrades('sui', 10);
  expect(trades).toHaveLength(1);
  expect(trades[0]!.value_usd).toBe(42.5);
});

it('records value_usd in trade log on rejection', async () => {
  const intent = createSwapIntent();
  const builder = createMockBuilder();
  const chainAdapter = createMockChainAdapter();
  const mevProtector = new NoOpMevProtector();

  policyRegistry.register({
    name: 'test_reject',
    description: 'Always rejects',
    evaluate: async () => ({
      status: 'reject' as const,
      reason: 'denied',
      detail: 'Denied',
    }),
  });

  const input: PipelineInput = {
    intent,
    builder,
    chainAdapter,
    policyRegistry,
    policyContext,
    mevProtector,
    tradeLog,
    logger,
    watchOnly: false,
    tradeValueUsd: 99.0,
  };

  await executePipeline(input);

  const trades = tradeLog.getRecentTrades('sui', 10);
  expect(trades).toHaveLength(1);
  expect(trades[0]!.value_usd).toBe(99.0);
});

it('records value_usd in trade log on watch-only simulation', async () => {
  const intent = createSwapIntent();
  const builder = createMockBuilder();
  const chainAdapter = createMockChainAdapter();
  const mevProtector = new NoOpMevProtector();

  const input: PipelineInput = {
    intent,
    builder,
    chainAdapter,
    policyRegistry,
    policyContext,
    mevProtector,
    tradeLog,
    logger,
    watchOnly: true,
    tradeValueUsd: 55.25,
  };

  await executePipeline(input);

  const trades = tradeLog.getRecentTrades('sui', 10);
  expect(trades).toHaveLength(1);
  expect(trades[0]!.value_usd).toBe(55.25);
});

it('returns tradeValueUsd in PipelineResult on success', async () => {
  const intent = createSwapIntent();
  const builder = createMockBuilder();
  const chainAdapter = createMockChainAdapter();
  const signer = createMockSigner();
  const mevProtector = new NoOpMevProtector();

  const input: PipelineInput = {
    intent,
    builder,
    chainAdapter,
    policyRegistry,
    policyContext,
    mevProtector,
    tradeLog,
    logger,
    signer,
    watchOnly: false,
    tradeValueUsd: 42.5,
  };

  const result = await executePipeline(input);
  expect(result.tradeValueUsd).toBe(42.5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/__tests__/transaction-pipeline.test.ts`
Expected: FAIL — `tradeValueUsd` not a property of `PipelineInput`, `value_usd` is null, `tradeValueUsd` not on `PipelineResult`.

- [ ] **Step 3: Add `tradeValueUsd` to `PipelineInput` and `PipelineResult`**

In `src/core/transaction-pipeline.ts`, add to the `PipelineInput` interface:

```typescript
readonly tradeValueUsd?: number;
```

In `src/core/action-types.ts`, add to the `PipelineResult` interface:

```typescript
readonly tradeValueUsd?: number;
```

- [ ] **Step 4: Add `valueUsd` to `buildTradeRecord` opts and thread into all call sites**

In `src/core/transaction-pipeline.ts`:

1. Add `readonly valueUsd?: number;` to `buildTradeRecord`'s `opts` parameter type.
2. Add `...(opts?.valueUsd !== undefined ? { value_usd: opts.valueUsd } : {}),` to the returned `TradeRecord`.
3. At all three `logTrade` call sites, pass `valueUsd: input.tradeValueUsd`:
   - Step 2 rejection (line ~127): `buildTradeRecord(intent, 'rejected', { rejectionReason, rejectionCheck, valueUsd: input.tradeValueUsd })`
   - Step 7 watch-only (line ~167): add `valueUsd: input.tradeValueUsd` to the opts object
   - Step 10 success (line ~209): add `valueUsd: input.tradeValueUsd` to the opts object
4. In the success return (line ~218), add `tradeValueUsd: input.tradeValueUsd` to the `PipelineResult`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bunx vitest run src/__tests__/transaction-pipeline.test.ts`
Expected: ALL PASS (including existing tests — no regressions).

- [ ] **Step 6: Update `swap.ts` to pass `tradeValueUsd` and populate CLI output**

In `src/cli/commands/swap.ts`:

1. In the `executePipeline` call (~line 170), add `tradeValueUsd` to the input object:
   ```typescript
   tradeValueUsd,
   ```

2. In `mapPipelineResultToOutput`, success case (~line 223), change `valueUsd: null` to:
   ```typescript
   valueUsd: result.tradeValueUsd ?? null,
   ```

- [ ] **Step 7: Run full test suite**

Run: `bunx vitest run`
Expected: ALL PASS.

- [ ] **Step 8: Run type check and formatter**

Run: `npx tsc --noEmit && npx prettier --check "src/**/*.ts" "src/**/*.tsx"`
Expected: No errors, all files formatted.

- [ ] **Step 9: Commit**

```bash
git add src/core/transaction-pipeline.ts src/core/action-types.ts src/cli/commands/swap.ts src/__tests__/transaction-pipeline.test.ts
git commit -m "feat: thread tradeValueUsd into pipeline trade log and CLI output"
```

---

### Task 2: Add `coin_metadata` DB Table and Repository

**Files:**
- Modify: `src/db/migrations.ts` (add CREATE TABLE)
- Create: `src/db/coin-metadata-repo.ts`
- Test: `src/__tests__/coin-metadata-repo.test.ts`

- [ ] **Step 1: Write failing tests for `CoinMetadataRepository`**

Create `src/__tests__/coin-metadata-repo.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { openMemoryDatabase } from '../db/connection.js';
import { CoinMetadataRepository } from '../db/coin-metadata-repo.js';
import type { CoinMetadataRow } from '../db/coin-metadata-repo.js';
import type Database from 'better-sqlite3';

describe('CoinMetadataRepository', () => {
  let db: Database.Database;
  let repo: CoinMetadataRepository;

  beforeEach(() => {
    db = openMemoryDatabase();
    repo = new CoinMetadataRepository(db);
  });

  const suiRow: CoinMetadataRow = {
    coin_type: '0x2::sui::SUI',
    chain: 'sui',
    symbol: 'SUI',
    name: 'Sui',
    decimals: 9,
  };

  const usdcRow: CoinMetadataRow = {
    coin_type: '0xdba3::usdc::USDC',
    chain: 'sui',
    symbol: 'USDC',
    name: null,
    decimals: 6,
  };

  describe('get', () => {
    it('returns null when no entry exists', () => {
      expect(repo.get('0x2::sui::SUI', 'sui')).toBeNull();
    });

    it('returns the row after upsert', () => {
      repo.upsert(suiRow);
      const result = repo.get('0x2::sui::SUI', 'sui');
      expect(result).toEqual(suiRow);
    });

    it('distinguishes by chain', () => {
      repo.upsert(suiRow);
      expect(repo.get('0x2::sui::SUI', 'evm')).toBeNull();
    });
  });

  describe('upsert', () => {
    it('inserts a new row', () => {
      repo.upsert(suiRow);
      expect(repo.get('0x2::sui::SUI', 'sui')).toEqual(suiRow);
    });

    it('replaces an existing row on conflict', () => {
      repo.upsert(suiRow);
      const updated = { ...suiRow, symbol: 'SUI2', decimals: 18 };
      repo.upsert(updated);
      expect(repo.get('0x2::sui::SUI', 'sui')).toEqual(updated);
    });
  });

  describe('getBulk', () => {
    it('returns empty array when no entries match', () => {
      expect(repo.getBulk(['0x2::sui::SUI'], 'sui')).toEqual([]);
    });

    it('returns matching rows', () => {
      repo.upsert(suiRow);
      repo.upsert(usdcRow);
      const results = repo.getBulk(['0x2::sui::SUI', '0xdba3::usdc::USDC'], 'sui');
      expect(results).toHaveLength(2);
      expect(results).toContainEqual(suiRow);
      expect(results).toContainEqual(usdcRow);
    });

    it('returns only rows matching the chain', () => {
      repo.upsert(suiRow);
      expect(repo.getBulk(['0x2::sui::SUI'], 'evm')).toEqual([]);
    });

    it('handles empty coinTypes array', () => {
      expect(repo.getBulk([], 'sui')).toEqual([]);
    });
  });

  describe('upsertBulk', () => {
    it('inserts multiple rows in a transaction', () => {
      repo.upsertBulk([suiRow, usdcRow]);
      expect(repo.get('0x2::sui::SUI', 'sui')).toEqual(suiRow);
      expect(repo.get('0xdba3::usdc::USDC', 'sui')).toEqual(usdcRow);
    });

    it('handles empty array without error', () => {
      repo.upsertBulk([]);
      expect(repo.getBulk([], 'sui')).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/__tests__/coin-metadata-repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add `coin_metadata` table to migrations**

In `src/db/migrations.ts`, add to the `MIGRATIONS` array (before the closing `]`):

```typescript
`CREATE TABLE IF NOT EXISTS coin_metadata (
  coin_type   TEXT    NOT NULL,
  chain       TEXT    NOT NULL,
  symbol      TEXT    NOT NULL,
  name        TEXT,
  decimals    INTEGER NOT NULL,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (coin_type, chain)
)`,
```

- [ ] **Step 4: Implement `CoinMetadataRepository`**

Create `src/db/coin-metadata-repo.ts`:

```typescript
import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';

/**
 * A row from the coin_metadata table.
 */
export interface CoinMetadataRow {
  readonly coin_type: string;
  readonly chain: string;
  readonly symbol: string;
  readonly name: string | null;
  readonly decimals: number;
}

/**
 * Repository for the coin_metadata table.
 * Uses cached prepared statements following the same pattern as TradeLog.
 */
export class CoinMetadataRepository {
  private readonly getStmt: Statement;
  private readonly upsertStmt: Statement;
  private readonly upsertBulkTxn: Database.Transaction<(rows: readonly CoinMetadataRow[]) => void>;

  constructor(private readonly db: Database.Database) {
    this.getStmt = db.prepare(
      'SELECT coin_type, chain, symbol, name, decimals FROM coin_metadata WHERE coin_type = ? AND chain = ?',
    );

    this.upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO coin_metadata (coin_type, chain, symbol, name, decimals)
      VALUES (@coin_type, @chain, @symbol, @name, @decimals)
    `);

    this.upsertBulkTxn = db.transaction((rows: readonly CoinMetadataRow[]) => {
      for (const row of rows) {
        this.upsertStmt.run({
          coin_type: row.coin_type,
          chain: row.chain,
          symbol: row.symbol,
          name: row.name,
          decimals: row.decimals,
        });
      }
    });
  }

  /**
   * Get a single coin metadata row by primary key.
   */
  get(coinType: string, chain: string): CoinMetadataRow | null {
    return (this.getStmt.get(coinType, chain) as CoinMetadataRow | undefined) ?? null;
  }

  /**
   * Get multiple coin metadata rows by coin types for a given chain.
   * Uses dynamic SQL since better-sqlite3 does not support array binds.
   */
  getBulk(coinTypes: readonly string[], chain: string): CoinMetadataRow[] {
    if (coinTypes.length === 0) return [];

    const placeholders = coinTypes.map(() => '?').join(', ');
    const stmt = this.db.prepare(
      `SELECT coin_type, chain, symbol, name, decimals FROM coin_metadata WHERE coin_type IN (${placeholders}) AND chain = ?`,
    );
    return stmt.all(...coinTypes, chain) as CoinMetadataRow[];
  }

  /**
   * Insert or replace a single coin metadata row.
   */
  upsert(row: CoinMetadataRow): void {
    this.upsertStmt.run({
      coin_type: row.coin_type,
      chain: row.chain,
      symbol: row.symbol,
      name: row.name,
      decimals: row.decimals,
    });
  }

  /**
   * Insert or replace multiple coin metadata rows in a single transaction.
   */
  upsertBulk(rows: readonly CoinMetadataRow[]): void {
    if (rows.length === 0) return;
    this.upsertBulkTxn(rows);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bunx vitest run src/__tests__/coin-metadata-repo.test.ts`
Expected: ALL PASS.

- [ ] **Step 6: Run type check and formatter**

Run: `npx tsc --noEmit && npx prettier --check "src/**/*.ts"`
Expected: No errors, all files formatted.

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations.ts src/db/coin-metadata-repo.ts src/__tests__/coin-metadata-repo.test.ts
git commit -m "feat: add coin_metadata table and CoinMetadataRepository"
```

---

### Task 3: Implement `CachedCoinMetadataService` Decorator

**Files:**
- Create: `src/data/cached-coin-metadata.ts`
- Test: `src/__tests__/cached-coin-metadata.test.ts`

- [ ] **Step 1: Write failing tests for `CachedCoinMetadataService`**

Create `src/__tests__/cached-coin-metadata.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openMemoryDatabase } from '../db/connection.js';
import { CoinMetadataRepository } from '../db/coin-metadata-repo.js';
import { CachedCoinMetadataService } from '../data/cached-coin-metadata.js';
import type { CoinMetadataService, CoinMetadata } from '../data/coin-metadata.js';
import type Database from 'better-sqlite3';

function createMockInner(overrides?: Partial<CoinMetadataService>): CoinMetadataService {
  return {
    getDecimals: vi.fn().mockResolvedValue(9),
    getMetadata: vi.fn().mockResolvedValue({
      coinType: '0x2::sui::SUI',
      symbol: 'SUI',
      decimals: 9,
    } satisfies CoinMetadata),
    prefetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('CachedCoinMetadataService', () => {
  let db: Database.Database;
  let repo: CoinMetadataRepository;
  let inner: CoinMetadataService;
  let service: CachedCoinMetadataService;

  beforeEach(() => {
    db = openMemoryDatabase();
    repo = new CoinMetadataRepository(db);
    inner = createMockInner();
    service = new CachedCoinMetadataService(repo, inner);
  });

  describe('getMetadata', () => {
    it('returns from DB without calling inner when cached', async () => {
      repo.upsert({
        coin_type: '0x2::sui::SUI',
        chain: 'sui',
        symbol: 'SUI',
        name: null,
        decimals: 9,
      });

      const result = await service.getMetadata('0x2::sui::SUI', 'sui');

      expect(result).toEqual({ coinType: '0x2::sui::SUI', symbol: 'SUI', decimals: 9 });
      expect(inner.getMetadata).not.toHaveBeenCalled();
    });

    it('delegates to inner on DB miss and backfills DB', async () => {
      const result = await service.getMetadata('0x2::sui::SUI', 'sui');

      expect(result).toEqual({ coinType: '0x2::sui::SUI', symbol: 'SUI', decimals: 9 });
      expect(inner.getMetadata).toHaveBeenCalledWith('0x2::sui::SUI', 'sui');

      // Verify backfill
      const cached = repo.get('0x2::sui::SUI', 'sui');
      expect(cached).not.toBeNull();
      expect(cached!.decimals).toBe(9);
    });

    it('propagates errors from inner (no silent failures)', async () => {
      inner = createMockInner({
        getMetadata: vi.fn().mockRejectedValue(new Error('API down')),
      });
      service = new CachedCoinMetadataService(repo, inner);

      await expect(service.getMetadata('0xunknown::foo::BAR', 'sui')).rejects.toThrow('API down');
    });
  });

  describe('getDecimals', () => {
    it('returns decimals via getMetadata', async () => {
      repo.upsert({
        coin_type: '0x2::sui::SUI',
        chain: 'sui',
        symbol: 'SUI',
        name: null,
        decimals: 9,
      });

      const decimals = await service.getDecimals('0x2::sui::SUI', 'sui');
      expect(decimals).toBe(9);
    });
  });

  describe('prefetch', () => {
    it('skips coins already in DB and fetches only uncached', async () => {
      repo.upsert({
        coin_type: '0x2::sui::SUI',
        chain: 'sui',
        symbol: 'SUI',
        name: null,
        decimals: 9,
      });

      const usdcMeta: CoinMetadata = {
        coinType: '0xdba3::usdc::USDC',
        symbol: 'USDC',
        decimals: 6,
      };
      inner = createMockInner({
        getMetadata: vi.fn().mockResolvedValue(usdcMeta),
        prefetch: vi.fn(),
      });
      service = new CachedCoinMetadataService(repo, inner);

      await service.prefetch(['0x2::sui::SUI', '0xdba3::usdc::USDC'], 'sui');

      // Inner should only be called for USDC (SUI is cached)
      expect(inner.getMetadata).toHaveBeenCalledTimes(1);
      expect(inner.getMetadata).toHaveBeenCalledWith('0xdba3::usdc::USDC', 'sui');

      // USDC should now be in DB
      const cached = repo.get('0xdba3::usdc::USDC', 'sui');
      expect(cached).not.toBeNull();
      expect(cached!.decimals).toBe(6);
    });

    it('does nothing when all coins are cached', async () => {
      repo.upsert({
        coin_type: '0x2::sui::SUI',
        chain: 'sui',
        symbol: 'SUI',
        name: null,
        decimals: 9,
      });

      await service.prefetch(['0x2::sui::SUI'], 'sui');

      expect(inner.getMetadata).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/__tests__/cached-coin-metadata.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CachedCoinMetadataService`**

Create `src/data/cached-coin-metadata.ts`:

```typescript
import type { CoinMetadata, CoinMetadataService } from './coin-metadata.js';
import type { CoinMetadataRepository } from '../db/coin-metadata-repo.js';

/**
 * Decorator that wraps any CoinMetadataService with DB-backed persistence.
 *
 * Resolution order:
 * 1. Local DB (CoinMetadataRepository)
 * 2. Inner service (e.g. NoodlesCoinMetadataService → Noodles API)
 * 3. On inner success → backfill DB for future calls
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

    // 2. Fetch uncached individually (getMetadata returns data + triggers backfill)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/__tests__/cached-coin-metadata.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Run type check and formatter**

Run: `npx tsc --noEmit && npx prettier --check "src/**/*.ts"`
Expected: No errors, all files formatted.

- [ ] **Step 6: Commit**

```bash
git add src/data/cached-coin-metadata.ts src/__tests__/cached-coin-metadata.test.ts
git commit -m "feat: add CachedCoinMetadataService decorator with DB persistence"
```

---

### Task 4: Wire CachedCoinMetadataService into Bootstrap

**Files:**
- Modify: `src/cli/bootstrap.ts`

- [ ] **Step 1: Update `buildCoinMetadataService` to use DB cache**

In `src/cli/bootstrap.ts`:

1. Add imports at the top:
   ```typescript
   import { CoinMetadataRepository } from '../db/coin-metadata-repo.js';
   import { CachedCoinMetadataService } from '../data/cached-coin-metadata.js';
   ```

2. Change the `buildCoinMetadataService` function signature from `(_logger: Logger)` to `(db: Database.Database)`:
   ```typescript
   export function buildCoinMetadataService(db: Database.Database): CoinMetadataService {
     const apiKey = process.env['NOODLES_API_KEY'];
     const inner = new NoodlesCoinMetadataService(SUI_KNOWN_DECIMALS, apiKey);
     const repo = new CoinMetadataRepository(db);
     return new CachedCoinMetadataService(repo, inner);
   }
   ```

3. Update the call site in `bootstrap()` (~line 74): change `buildCoinMetadataService(logger)` to `buildCoinMetadataService(db)`.

4. Remove the now-unused `Logger` import if it's only used by `buildCoinMetadataService` (check — it's likely still used by `getLogger()`).

- [ ] **Step 2: Run full test suite**

Run: `bunx vitest run`
Expected: ALL PASS.

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/cli/bootstrap.ts
git commit -m "feat: wire CachedCoinMetadataService into bootstrap with DB persistence"
```

---

### Task 5: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `bunx vitest run`
Expected: ALL PASS, no regressions.

- [ ] **Step 2: Run type check and formatter**

Run: `npx tsc --noEmit && npx prettier --check "src/**/*.ts" "src/**/*.tsx"`
Expected: No errors, all files formatted.

- [ ] **Step 3: Verify all tasks are complete**

Review checklist:
- `value_usd` is threaded through pipeline to all three `logTrade` call sites
- `tradeValueUsd` is on `PipelineResult` and populates `SuccessResponse.valueUsd`
- `coin_metadata` table exists in migrations
- `CoinMetadataRepository` handles get, getBulk, upsert, upsertBulk
- `CachedCoinMetadataService` checks DB first, delegates to inner on miss, backfills
- Bootstrap wires the cached service with DB
- All existing tests still pass
