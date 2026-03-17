# Wallet Alias Design

**Date:** 2026-03-17
**Status:** Approved
**Scope:** Add alias support to wallet management — create, import, watch-only, switch, rename.

## Decisions

| Decision | Choice |
|----------|--------|
| Alias required? | Optional — auto-generated if omitted |
| Uniqueness | Globally unique (not per-chain) |
| Switch mechanism | Sets `is_primary=1` for the wallet's chain, unsets others on same chain |

## DB Change

Add `alias TEXT UNIQUE` column to `wallets` table:

```sql
ALTER TABLE wallets ADD COLUMN alias TEXT UNIQUE;
```

Backfill existing rows with auto-generated aliases. Format: `{chain}-{n}` (e.g., `sui-1`, `sui-2`). Watch-only wallets: `{chain}-watch-{n}`.

Migration is idempotent — try-catch for duplicate column, then backfill only rows where `alias IS NULL`.

## Type Changes

```typescript
// src/wallet/types.ts
interface WalletInfo {
  // ... existing fields ...
  readonly alias: string;  // always present
}

interface WalletRow {
  // ... existing fields ...
  readonly alias: string | null;  // nullable in DB for migration compat
}
```

## Manager API

### Modified functions

- `generateWallet(db, alias?)` — auto-generates alias if omitted
- `importFromMnemonic(db, mnemonic, alias?)` — same
- `registerWalletAddress(db, chain, address, isPrimary?, isWatchOnly?, alias?)` — same

### New functions

```typescript
function switchWallet(db: Database.Database, alias: string): void
// Sets is_primary=1 for wallet with this alias, is_primary=0 for all others on same chain
// Throws if alias not found

function renameAlias(db: Database.Database, oldAlias: string, newAlias: string): void
// Updates alias column
// Throws if oldAlias not found
// Throws if newAlias already taken (UNIQUE constraint)

function getWalletByAlias(db: Database.Database, alias: string): WalletInfo | null
// Lookup by alias

function generateAlias(db: Database.Database, chain: string, isWatchOnly: boolean): string
// Generates next available alias: {chain}-{n} or {chain}-watch-{n}
// Queries existing aliases to find next number
```

### Updated internals

- `insertWallet` SQL includes `alias` column
- `rowToWalletInfo` maps `alias` (uses auto-generated fallback if null for legacy rows)

## CLI Commands

### New subcommands

```
fence wallet switch <alias>     # Set wallet as primary for its chain
fence wallet rename <old> <new> # Rename wallet alias
```

### Modified commands (add --alias flag)

```
fence setup [--alias <name>]
fence wallet watch <address> [--alias <name>]
```

### `fence wallet list` output

```
  Alias        Chain  Address                    Primary  Watch-Only
  sui-1        sui    0x7a3f...e821              *
  sui-watch-1  sui    0xdead...beef                       *
```

## Swap Command

No changes — uses `getPrimaryWallet(db, chain)` which still works. `switch` changes which wallet is primary.

## Testing

| Test | Coverage |
|------|----------|
| `wallet-alias.test.ts` | Auto-generate alias, custom alias, uniqueness constraint, switch sets primary, rename, getByAlias |
