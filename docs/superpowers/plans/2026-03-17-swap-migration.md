# Swap Feature Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the working swap pipeline from `sui-defi-cli` into `onlyfence` with a generic transaction flow, plus watch-only wallet support.

**Architecture:** Single `ActionIntent` discriminated union flows through the entire system — pipeline, policy, builders, logging. `ActionBuilder` per protocol, `ChainAdapter` per chain, `MevProtector` per chain, all wired via registries. Pipeline is a stateless function `executePipeline()`.

**Tech Stack:** TypeScript strict, `@mysten/sui`, `@7kprotocol/sdk-ts`, `better-sqlite3`, `commander`, `vitest`

**Spec:** `docs/superpowers/specs/2026-03-17-swap-migration-design.md`

**Reference codebase (old CLI):** `/Users/otis/Documents/sui-defi-cli/src/`

---

## Chunk 1: Core Types, Interfaces and Policy Refactor

### Task 1: ActionIntent discriminated union and core types

**Files:**
- Create: `src/core/action-types.ts`
- Modify: `src/types/intent.ts` (replace TradeIntent/TradeAction with re-exports)
- Test: `src/__tests__/action-types.test.ts`

- [ ] **Step 1: Write failing test for ActionIntent type discrimination**

```typescript
// src/__tests__/action-types.test.ts
import { describe, it, expect } from 'vitest';
import type { ActionIntent, SwapIntent } from '../core/action-types.js';

describe('ActionIntent', () => {
  it('discriminates SwapIntent by action field', () => {
    const intent: ActionIntent = {
      action: 'swap',
      chain: 'sui',
      walletAddress: '0x' + 'a'.repeat(64),
      params: {
        coinTypeIn: '0x2::sui::SUI',
        coinTypeOut: '0xdba3::usdc::USDC',
        amountIn: '1000000000',
        slippageBps: 100,
      },
    };

    expect(intent.action).toBe('swap');
    if (intent.action === 'swap') {
      expect(intent.params.coinTypeIn).toBe('0x2::sui::SUI');
      expect(intent.params.slippageBps).toBe(100);
    }
  });

  it('discriminates SupplyIntent by action field', () => {
    const intent: ActionIntent = {
      action: 'supply',
      chain: 'sui',
      walletAddress: '0x' + 'a'.repeat(64),
      params: {
        coinType: '0x2::sui::SUI',
        amount: '1000000000',
        protocol: 'navi',
      },
    };

    expect(intent.action).toBe('supply');
    if (intent.action === 'supply') {
      expect(intent.params.protocol).toBe('navi');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/action-types.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Create `src/core/action-types.ts`**

```typescript
export type DeFiAction = 'swap' | 'supply' | 'lp_deposit' | 'lp_withdraw';

export interface ActionIntentBase {
  readonly chain: string;
  readonly action: DeFiAction;
  readonly walletAddress: string;
}

export interface SwapIntent extends ActionIntentBase {
  readonly action: 'swap';
  readonly params: {
    readonly coinTypeIn: string;
    readonly coinTypeOut: string;
    readonly amountIn: string;
    readonly slippageBps: number;
  };
}

export interface SupplyIntent extends ActionIntentBase {
  readonly action: 'supply';
  readonly params: {
    readonly coinType: string;
    readonly amount: string;
    readonly protocol: string;
  };
}

export type ActionIntent = SwapIntent | SupplyIntent;

export type PipelineStatus =
  | 'success'
  | 'simulated'
  | 'rejected'
  | 'simulation_failed'
  | 'error';

export interface PipelineResult {
  readonly status: PipelineStatus;
  readonly preview?: ActionPreview;
  readonly txDigest?: string;
  readonly gasUsed?: number;
  readonly amountOut?: string;
  readonly error?: string;
  readonly rejectionCheck?: string;
  readonly rejectionReason?: string;
}

export interface ActionPreview {
  readonly description: string;
  readonly expectedOutput: string;
  readonly provider: string;
  readonly priceImpact?: number;
  readonly buildData: unknown;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/action-types.test.ts`
Expected: PASS

- [ ] **Step 5: Update `src/types/intent.ts` to re-export from core**

```typescript
export type { DeFiAction as TradeAction } from '../core/action-types.js';
export type { ActionIntent as TradeIntent } from '../core/action-types.js';
```

- [ ] **Step 6: Run full test suite to identify breakages**

Run: `npx vitest run`
Expected: Some tests fail due to TradeIntent shape change. Fix in Task 2.

- [ ] **Step 7: Commit**

```
git add src/core/action-types.ts src/types/intent.ts src/__tests__/action-types.test.ts
git commit -m "feat: add ActionIntent discriminated union, replace TradeIntent"
```

---

### Task 2: Refactor policy engine to use ActionIntent

**Files:**
- Modify: `src/policy/check.ts`
- Modify: `src/policy/registry.ts`
- Modify: `src/policy/checks/token-allowlist.ts`
- Modify: `src/policy/checks/spending-limit.ts`
- Modify: `src/__tests__/token-allowlist.test.ts`
- Modify: `src/__tests__/spending-limit.test.ts`
- Modify: `src/__tests__/registry.test.ts`

- [ ] **Step 1: Update `src/policy/check.ts`**

Change import from `TradeIntent` to `ActionIntent`:

```typescript
import type { ActionIntent } from '../core/action-types.js';
import type { CheckResult } from '../types/result.js';
import type { PolicyContext } from './context.js';

export const REJECTED_BY_KEY = 'rejectedBy' as const;

export interface PolicyCheck {
  readonly name: string;
  readonly description: string;
  evaluate(intent: ActionIntent, ctx: PolicyContext): Promise<CheckResult>;
}
```

- [ ] **Step 2: Update `src/policy/registry.ts`**

Change import from `TradeIntent` to `ActionIntent`. Update `evaluateAll` signature.

- [ ] **Step 3: Refactor `src/policy/checks/token-allowlist.ts`**

Import `ActionIntent` and `SwapIntent`. Use action discriminant to extract tokens. Add `extractTokenSymbol` helper to get symbol from fully-qualified coin type:

```typescript
function extractTokenSymbol(coinType: string): string {
  const parts = coinType.split('::');
  return parts[parts.length - 1] ?? coinType;
}
```

For non-swap actions, return `{ status: 'pass' }`.

- [ ] **Step 4: Refactor `src/policy/checks/spending-limit.ts`**

Import `ActionIntent`. The check is action-agnostic since it uses `ctx.tradeValueUsd` and `intent.chain` which are available on all intents.

- [ ] **Step 5: Update all policy test files**

Replace `TradeIntent` objects with `SwapIntent` shape. Token names change from `"SUI"` to coin types `"0x2::sui::SUI"` in tests (the `extractTokenSymbol` function extracts the symbol).

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 7: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 8: Commit**

```
git add src/policy/ src/__tests__/
git commit -m "refactor: policy engine accepts ActionIntent instead of TradeIntent"
```

---

### Task 3: ActionBuilder interface and ActionBuilderRegistry

**Files:**
- Create: `src/core/action-builder.ts`
- Test: `src/__tests__/action-builder-registry.test.ts`

- [ ] **Step 1: Write failing tests for ActionBuilderRegistry**

Test: register, get, getDefault (first registered), duplicate key, chain mismatch, missing key, registerFactory with/without intent, has.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/action-builder-registry.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `src/core/action-builder.ts`**

Contains: `BuiltTransaction` interface, `ActionBuilder<T>` interface (with `builderId`, `chain`, `validate`, `preview`, `build`), `ActionBuilderRegistry` class with `register`, `registerFactory`, `get`, `getDefault`, `has`. Re-exports `ActionPreview` from `action-types.ts`.

Key: `getDefault` iterates builders then factories in insertion order, returns first match for `${chain}:${action}:` prefix. `register` asserts `builder.chain === chain`. Factory `get` throws if intent not provided.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/action-builder-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add src/core/action-builder.ts src/__tests__/action-builder-registry.test.ts
git commit -m "feat: add ActionBuilder interface and ActionBuilderRegistry"
```

---

### Task 4: MevProtector interface and NoOpMevProtector

**Files:**
- Create: `src/core/mev-protector.ts`
- Test: `src/__tests__/mev-protector.test.ts`

- [ ] **Step 1: Write failing test**

Test: NoOpMevProtector returns bytes unchanged, name is "noop".

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement `src/core/mev-protector.ts`**

`ProtectedTransaction` interface, `MevProtector` interface, `NoOpMevProtector` class.

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```
git add src/core/mev-protector.ts src/__tests__/mev-protector.test.ts
git commit -m "feat: add MevProtector interface and NoOpMevProtector"
```

---

### Task 5: Refactor ChainAdapter interface and update Signer

**Files:**
- Modify: `src/chain/adapter.ts`
- Modify: `src/types/result.ts`
- Modify: `src/chain/sui/adapter.ts`
- Modify: `src/__tests__/chain-adapter.test.ts`

- [ ] **Step 1: Add `publicKey: Uint8Array` to `Signer` in `src/types/result.ts`**

- [ ] **Step 2: Rewrite `src/chain/adapter.ts` with new interface**

Remove swap methods. New methods: `getBalance`, `buildTransactionBytes`, `simulate`, `signAndSubmit`.

- [ ] **Step 3: Update `src/chain/sui/adapter.ts` placeholder**

Match new interface. All methods still throw "not implemented".

- [ ] **Step 4: Update chain-adapter tests**

- [ ] **Step 5: Run typecheck and tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```
git add src/chain/ src/types/result.ts src/__tests__/chain-adapter.test.ts
git commit -m "refactor: ChainAdapter uses raw bytes interface, Signer exposes publicKey"
```

---

### Task 6: Chunk 1 cleanup

- [ ] **Step 1: Run format, lint, typecheck**

Run: `npm run format && npm run lint && npm run typecheck`

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit any fixes**

```
git add -A && git commit -m "chore: format and lint after core types refactor"
```

---

## Chunk 2: Sui Chain Implementation

### Task 7: SuiChainAdapter working implementation

**Files:**
- Rewrite: `src/chain/sui/adapter.ts`
- Test: `src/__tests__/sui-adapter.test.ts`
- Reference: `/Users/otis/Documents/sui-defi-cli/src/chains/sui/sui-adapter.ts`

- [ ] **Step 1: Write failing tests with mocked SuiClient**

Test: `buildTransactionBytes`, `simulate` (success + failure), `signAndSubmit` (97-byte signature construction), `getBalance`.

- [ ] **Step 2: Run tests, verify fail**

- [ ] **Step 3: Implement SuiChainAdapter**

Constructor takes `rpcUrl`, creates owned `SuiClient`. Port methods from old CLI. Key: `signAndSubmit` constructs 97-byte Sui signature `[0x00, ...rawSig, ...pubKey]`, base64-encodes, calls `executeTransactionBlock`.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```
git add src/chain/sui/adapter.ts src/__tests__/sui-adapter.test.ts
git commit -m "feat: implement SuiChainAdapter with working RPC integration"
```

---

### Task 8: Install 7K SDK and SuiSwapBuilder

**Files:**
- Create: `src/chain/sui/builder/swap-builder.ts`
- Test: `src/__tests__/sui-swap-builder.test.ts`
- Reference: `/Users/otis/Documents/sui-defi-cli/src/chains/sui/sui-swap.ts`

- [ ] **Step 1: Install 7K SDK**

Run: `npm install @7kprotocol/sdk-ts`

- [ ] **Step 2: Write failing tests with mocked MetaAg**

Test: `validate` (rejects same coin, zero amount), `preview` (returns ActionPreview), `build` (returns BuiltTransaction), `builderId`/`chain` fields.

- [ ] **Step 3: Run tests, verify fail**

- [ ] **Step 4: Implement SuiSwapBuilder**

Port from old CLI. `builderId = '7k-swap'`, `chain = 'sui'`. Constructor takes `slippageBps`, creates `MetaAg`. Methods: `validate`, `preview` (calls `metaAg.quote`), `build` (calls `metaAg.swap`, adds transfer move).

- [ ] **Step 5: Run tests, verify pass**

- [ ] **Step 6: Commit**

```
git add src/chain/sui/builder/ src/__tests__/sui-swap-builder.test.ts package.json
git commit -m "feat: add SuiSwapBuilder with 7K Aggregator integration"
```

---

### Task 9: SuiNoOpMev

**Files:**
- Create: `src/chain/sui/sui-mev.ts`

- [ ] **Step 1: Create SuiNoOpMev**

Implements `MevProtector`. Returns bytes unchanged.

- [ ] **Step 2: Run typecheck**

- [ ] **Step 3: Commit**

```
git add src/chain/sui/sui-mev.ts
git commit -m "feat: add SuiNoOpMev placeholder"
```

---

## Chunk 3: Transaction Pipeline

### Task 10: executePipeline function

**Files:**
- Create: `src/core/transaction-pipeline.ts`
- Test: `src/__tests__/transaction-pipeline.test.ts`
- Reference: `/Users/otis/Documents/sui-defi-cli/src/core/transaction-pipeline.ts`

- [ ] **Step 1: Write failing tests for all 5 status paths**

With mocked dependencies, test: `success` (full flow), `rejected` (policy rejects), `simulation_failed`, `simulated` (watchOnly, includes gasEstimate), `error` (validate throws).

- [ ] **Step 2: Run tests, verify fail**

- [ ] **Step 3: Implement executePipeline**

Stateless function. Steps: validate, policy, preview, build, serialize, simulate, watch-only check, MEV protect, sign+submit, log. Each step wrapped in try/catch. Uses `REJECTED_BY_KEY` from policy. Logs trades via `tradeLog.logTrade()`. Watch-only logs with `tx_digest: 'watch-only'`.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```
git add src/core/transaction-pipeline.ts src/__tests__/transaction-pipeline.test.ts
git commit -m "feat: add executePipeline generic transaction orchestrator"
```

---

## Chunk 4: Watch-Only Wallet

### Task 11: DB migration, wallet types, manager update

**Files:**
- Modify: `src/db/migrations.ts`
- Modify: `src/wallet/types.ts`
- Modify: `src/wallet/manager.ts`
- Test: `src/__tests__/watch-only.test.ts`

- [ ] **Step 1: Write failing tests for watch-only wallet**

Test: register with isWatchOnly=true, verify flag persists, default isWatchOnly=false.

- [ ] **Step 2: Run tests, verify fail**

- [ ] **Step 3: Add ALTER TABLE migration**

In `runMigrations`, after existing migrations. Try-catch swallows only "duplicate column name" errors, re-throws all others.

- [ ] **Step 4: Update wallet types**

Add `isWatchOnly` to `WalletInfo` and `is_watch_only` to `WalletRow`.

- [ ] **Step 5: Update wallet manager**

Add `isWatchOnly` param to `registerWalletAddress`. Update `insertWallet` SQL. Update `rowToWalletInfo`. Update `generateWallet`/`importFromMnemonic` callers.

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```
git add src/db/migrations.ts src/wallet/ src/__tests__/watch-only.test.ts
git commit -m "feat: add watch-only wallet support with DB migration"
```

---

## Chunk 5: CLI Wiring

### Task 12: Signer resolution

**Files:**
- Create: `src/wallet/signer.ts`
- Test: `src/__tests__/signer.test.ts`

- [ ] **Step 1: Write failing tests**

Test env var priority, keystore loading. Mock process.env and keystore.

- [ ] **Step 2: Run tests, verify fail**

- [ ] **Step 3: Implement resolveSuiSigner**

Priority: SUI_PRIVATE_KEY env, SUI_MNEMONIC env, encrypted keystore. Returns `Signer` wrapping Ed25519Keypair with `address`, `publicKey`, `sign`.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```
git add src/wallet/signer.ts src/__tests__/signer.test.ts
git commit -m "feat: add resolveSuiSigner for keypair resolution"
```

---

### Task 13: CLI output SimulatedResponse

**Files:**
- Modify: `src/cli/output.ts`

- [ ] **Step 1: Add SimulatedResponse and update CliOutput union**

- [ ] **Step 2: Run typecheck**

- [ ] **Step 3: Commit**

```
git add src/cli/output.ts
git commit -m "feat: add SimulatedResponse to CLI output types"
```

---

### Task 14: Bootstrap new components

**Files:**
- Modify: `src/cli/bootstrap.ts`

- [ ] **Step 1: Add ActionBuilderRegistry and MevProtectors to AppComponents and bootstrap**

- [ ] **Step 2: Run typecheck and tests**

- [ ] **Step 3: Commit**

```
git add src/cli/bootstrap.ts
git commit -m "feat: register ActionBuilderRegistry and MevProtectors in bootstrap"
```

---

### Task 15: Rewrite swap command

**Files:**
- Rewrite: `src/cli/commands/swap.ts`

- [ ] **Step 1: Rewrite to use executePipeline**

Parse args, resolve wallet (check isWatchOnly), resolve coin types, build SwapIntent, fetch oracle price, resolve signer, call executePipeline, map PipelineResult to CliOutput + exit code.

- [ ] **Step 2: Run typecheck**

- [ ] **Step 3: Commit**

```
git add src/cli/commands/swap.ts
git commit -m "refactor: swap command uses executePipeline"
```

---

### Task 16: fence wallet watch command

**Files:**
- Create: `src/cli/commands/wallet-watch.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Implement watch command**

Validates Sui address with `/^0x[0-9a-fA-F]{64}$/`. Calls `registerWalletAddress(db, chain, address, false, true)`.

- [ ] **Step 2: Register in CLI index**

- [ ] **Step 3: Run typecheck**

- [ ] **Step 4: Commit**

```
git add src/cli/commands/wallet-watch.ts src/cli/index.ts
git commit -m "feat: add fence wallet watch command"
```

---

## Chunk 6: Final Verification

### Task 17: Full lint, format, typecheck, test

- [ ] **Step 1: Run format**

Run: `npm run format`

- [ ] **Step 2: Run lint**

Run: `npm run lint`

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`

- [ ] **Step 5: Commit any fixes**

```
git add -A && git commit -m "chore: final lint and format pass"
```

---

### Task 18: Remove dead types

- [ ] **Step 1: Check if SwapParams, SwapQuote, TransactionData are still imported**

If unused, remove from `src/types/result.ts`.

- [ ] **Step 2: Run typecheck**

- [ ] **Step 3: Commit**

```
git add src/types/result.ts
git commit -m "chore: remove unused SwapParams, SwapQuote, TransactionData types"
```
