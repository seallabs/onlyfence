# Swap Feature Migration Design

**Date:** 2026-03-17
**Status:** Draft
**Source:** Migrate swap feature from `sui-defi-cli` prototype into `onlyfence`, plus watch-only wallet support.

## Context

OnlyFence has a working policy engine, wallet management, config, oracle, logging, and CLI shell — but the chain adapter is a placeholder (all methods throw "not implemented"). The `sui-defi-cli` prototype has a working swap implementation using 7K Aggregator, a generic `TransactionPipeline`, `ActionBuilder` pattern, and watch-only wallet support.

This design migrates the swap execution pipeline and watch-only wallets from the old CLI into OnlyFence's architecture, while making the transaction flow generic enough for multi-chain, multi-protocol, and multi-action extensibility.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Single generic `ActionIntent` replaces `TradeIntent` | Yes | One intent type flows through the entire pipeline including policy; discriminated by `action` field |
| Separate `ActionBuilder` from `ChainAdapter` | Yes (old CLI pattern) | Adding a new DEX or action doesn't require modifying the chain adapter |
| Generic `TransactionPipeline` | Yes | Single orchestrator for all DeFi actions across all chains |
| MEV protection | Explicit pipeline step with chain-specific strategy | Configurable, visible, extensible per chain |
| Watch-only scope | Simulate only (no external signing) | Simple, covers monitoring/paper-trading use case |
| Policy integration | Wrap existing `PolicyCheckRegistry` in pipeline | Reuses working code, no new abstraction needed |
| Builder resolution | `ActionBuilderRegistry` keyed by `(chain, action, protocol)` | Matches existing factory patterns, one-line registration for new protocols |
| 7K SDK dependency | Direct `@7kprotocol/sdk-ts` | `ActionBuilder` interface is already the abstraction boundary |
| Migration approach | Parallel layers (interfaces + impl together, layer by layer) | Each layer self-contained and testable |

## Architecture Overview

```
Agent: fence swap SUI USDC 100 --slippage 0.5

CLI (swap command)
  |
  ├─ Parse args → SwapIntent (ActionIntent)
  ├─ Resolve wallet (check isWatchOnly)
  ├─ Fetch oracle price → PolicyContext
  ├─ Resolve signer (skip if watch-only)
  |
  └─ executePipeline(PipelineInput)
       |
       ├─ 1. builder.validate(intent)
       ├─ 2. policyRegistry.evaluateAll(intent, ctx)        ← policy engine (refactored to ActionIntent)
       ├─ 3. builder.preview(intent)                        ← fetch quotes from 7K
       ├─ 4. builder.build(intent, preview)                 ← build Sui Transaction
       ├─ 5. chainAdapter.buildTransactionBytes(tx)         ← serialize
       ├─ 6. chainAdapter.simulate(txBytes, sender)         ← dry-run
       ├─ 7. [watch-only? → STOP, return 'simulated']
       ├─ 8. mevProtector.protect(txBytes, chain)           ← no-op on Sui
       ├─ 9. chainAdapter.signAndSubmit(bytes, signer)      ← sign + submit
       └─ 10. tradeLog.logTrade(...)                        ← record to SQLite
```

## Module Structure

```
src/
├── core/                              # NEW — generic pipeline & interfaces
│   ├── action-types.ts                # ActionIntent (discriminated union), SwapIntent, ActionPreview, PipelineResult
│   ├── action-builder.ts              # ActionBuilder interface + ActionBuilderRegistry
│   ├── transaction-pipeline.ts        # executePipeline() function
│   └── mev-protector.ts              # MevProtector interface + NoOpMevProtector
├── chain/                             # EXISTING — refactored
│   ├── adapter.ts                     # ChainAdapter interface (trimmed: no swap methods)
│   ├── factory.ts                     # ChainAdapterFactory (existing, unchanged)
│   └── sui/                           # Per-chain subdirectory
│       ├── adapter.ts                 # SuiChainAdapter (working impl)
│       ├── builder/                   # Action builders for Sui
│       │   └── swap-builder.ts        # SuiSwapBuilder (7K Aggregator)
│       ├── tokens.ts                  # Token map (existing, moved)
│       ├── client.ts                  # SuiClient creation (no singleton)
│       └── sui-mev.ts                # SuiNoOpMev placeholder
├── wallet/                            # EXISTING — extended
│   ├── manager.ts                     # Extend registerWalletAddress() + update rowToWalletInfo()
│   ├── signer.ts                      # NEW — resolveSuiSigner()
│   ├── keystore.ts                    # Existing, unchanged
│   └── types.ts                       # Add isWatchOnly to WalletInfo/WalletRow
├── db/                                # EXISTING — migration added
│   └── migrations.ts                  # Add is_watch_only column to wallets
├── cli/
│   ├── bootstrap.ts                   # Add ActionBuilderRegistry + MevProtectors
│   ├── commands/
│   │   ├── swap.ts                    # Rewritten to use executePipeline()
│   │   └── wallet-watch.ts            # NEW — fence wallet watch <address>
│   └── output.ts                      # Add 'simulated' response type
├── policy/                            # REFACTORED — PolicyCheck.evaluate() accepts ActionIntent
│   ├── check.ts                       # PolicyCheck interface updated
│   ├── context.ts                     # PolicyContext unchanged
│   ├── registry.ts                    # PolicyCheckRegistry.evaluateAll() accepts ActionIntent
│   └── checks/                        # Each check refactored to use intent.action discriminant
├── config/                            # UNCHANGED
├── oracle/                            # UNCHANGED
└── logger/                            # UNCHANGED
```

## Breaking Interface Changes

The following existing interfaces are renamed or re-signatured:

| Existing | New | Change |
|----------|-----|--------|
| `ChainAdapter.getSwapQuote()` | Removed | Moved to `ActionBuilder.preview()` |
| `ChainAdapter.buildSwapTx()` | Removed | Moved to `ActionBuilder.build()` |
| `ChainAdapter.simulateTx(txData: TransactionData)` | `simulate(txBytes: Uint8Array, sender: string)` | Renamed; takes raw bytes + sender instead of `TransactionData` |
| `ChainAdapter.signAndSubmit(txData, signer)` | `signAndSubmit(txBytes: Uint8Array, signer: Signer)` | Takes raw bytes; adapter is responsible for calling `signer.sign()` internally and encoding the result |
| `SwapParams`, `SwapQuote`, `TransactionData` | No longer used by `ChainAdapter` | These types remain in `types/result.ts` but are no longer part of the adapter interface |
| `TradeIntent` (from `types/intent.ts`) | Removed — replaced by `ActionIntent` | Single generic intent type used across pipeline and policy engine; discriminated union via `action` field |
| `PolicyCheck.evaluate(intent: TradeIntent, ...)` | `evaluate(intent: ActionIntent, ...)` | Policy checks refactored to extract fields from `intent.params` instead of top-level `TradeIntent` fields |

**Signing responsibility:** The Sui serialized signature format is: `[scheme_flag (1 byte)] || [signature (64 bytes)] || [public_key (32 bytes)]` — 97 bytes total, then base64-encoded.

The `Signer` interface must be extended to expose the public key:

```typescript
// src/types/result.ts (modified)
interface Signer {
  readonly address: string;
  readonly publicKey: Uint8Array;  // NEW — 32 bytes for Ed25519
  sign(data: Uint8Array): Promise<Uint8Array>;
}
```

The `SuiChainAdapter.signAndSubmit()` is responsible for:
1. Calling `signer.sign(txBytes)` to get raw 64-byte Ed25519 signature
2. Constructing the Sui serialized signature: `[0x00, ...signature, ...signer.publicKey]` (97 bytes)
3. Base64-encoding the result for `client.executeTransactionBlock({ signature })`

This keeps chain-specific encoding inside the chain adapter where it belongs.

## Section 1: Core Types & Interfaces

### ActionIntent — single generic intent (discriminated union)

`ActionIntent` replaces the old `TradeIntent`. It is the **only** intent type in the system — used by the pipeline, policy engine, builders, and trade logging. The `action` field discriminates which `params` shape is carried.

```typescript
// src/core/action-types.ts

/** Supported DeFi actions — extend this union to add new action types */
type DeFiAction = 'swap' | 'supply' | 'lp_deposit' | 'lp_withdraw';

/** Base intent — all actions share these fields */
interface ActionIntentBase {
  readonly chain: string;
  readonly action: DeFiAction;
  readonly walletAddress: string;
}

/** Swap-specific intent */
interface SwapIntent extends ActionIntentBase {
  readonly action: 'swap';
  readonly params: {
    readonly coinTypeIn: string;    // fully-qualified Move type / ERC-20 address
    readonly coinTypeOut: string;
    readonly amountIn: string;      // raw amount in smallest unit (e.g., MIST)
    readonly slippageBps: number;
  };
}

/** Supply-specific intent (future) */
interface SupplyIntent extends ActionIntentBase {
  readonly action: 'supply';
  readonly params: {
    readonly coinType: string;
    readonly amount: string;
    readonly protocol: string;
  };
}

// ... more intents added here as new actions are supported

/** Discriminated union — the single intent type used everywhere */
type ActionIntent = SwapIntent | SupplyIntent;
// Extend with: | LpDepositIntent | LpWithdrawIntent | ...
```

**Key design points:**
- `TradeIntent` from `src/types/intent.ts` is **deleted** — `ActionIntent` replaces it everywhere
- `TradeAction` type from `src/types/intent.ts` is replaced by `DeFiAction` (broader scope)
- Policy checks receive `ActionIntent` and use the `action` discriminant to extract the fields they need
- Adding a new action = add a new interface + add it to the union. No changes to pipeline, policy engine, or existing checks

### Policy engine refactoring

The existing policy checks (`TokenAllowlistCheck`, `SpendingLimitCheck`) are refactored to accept `ActionIntent` instead of `TradeIntent`:

```typescript
// src/policy/check.ts (modified)
import type { ActionIntent } from '../core/action-types.js';

interface PolicyCheck {
  readonly name: string;
  readonly description: string;
  evaluate(intent: ActionIntent, ctx: PolicyContext): Promise<CheckResult>;
}
```

Each check extracts what it needs based on the `action` discriminant:

```typescript
// TokenAllowlistCheck — extract tokens from intent.params
evaluate(intent: ActionIntent, ctx: PolicyContext): Promise<CheckResult> {
  if (intent.action === 'swap') {
    // TypeScript narrows to SwapIntent — intent.params.coinTypeIn is typed
    const { coinTypeIn, coinTypeOut } = intent.params;
    // check against allowlist...
  }
  // Other action types: extract their relevant tokens similarly
}

// SpendingLimitCheck — extract amount from intent.params
evaluate(intent: ActionIntent, ctx: PolicyContext): Promise<CheckResult> {
  if (intent.action === 'swap') {
    const { amountIn } = intent.params;
    // check against limits...
  }
}
```

This keeps the policy engine fully generic — new action types just add new branches in the checks that care about them. Checks that don't apply to an action type return `pass`.

### ActionBuilder interface

```typescript
// src/core/action-builder.ts

interface ActionPreview {
  readonly description: string;
  readonly expectedOutput: string;  // raw amount in token's smallest unit, derived from buildData
  readonly provider: string;
  readonly priceImpact?: number;
  readonly buildData: unknown;      // opaque, passed to build(); source of truth for amounts
}

interface ActionBuilder<T extends ActionIntent = ActionIntent> {
  readonly builderId: string;
  readonly chain: string;           // chain this builder targets (for registration validation)
  validate(intent: T): void;
  preview(intent: T): Promise<ActionPreview>;
  build(intent: T, preview: ActionPreview): Promise<BuiltTransaction>;
}

interface BuiltTransaction {
  readonly transaction: unknown;
  readonly metadata: Record<string, unknown>;
}
```

**Note on `expectedOutput`:** This is a convenience field derived from `buildData` by the builder during `preview()`. For `SuiSwapBuilder`, it is set from the 7K quote's `amountOut` field (raw integer string in the output token's smallest unit). `buildData` remains the canonical source — `expectedOutput` is for display/logging only.

### ActionBuilderRegistry

```typescript
// src/core/action-builder.ts

type BuilderKey = `${string}:${string}:${string}`;  // "sui:swap:7k"

class ActionBuilderRegistry {
  private readonly builders = new Map<BuilderKey, ActionBuilder>();
  private readonly factories = new Map<BuilderKey, (intent: ActionIntent) => ActionBuilder>();

  /**
   * Register a pre-built builder instance. Asserts builder.chain === chain parameter.
   * @throws Error if key already registered or chain mismatch
   */
  register(chain: string, action: string, protocol: string, builder: ActionBuilder): void;

  /**
   * Register a factory function for builders that need per-trade configuration.
   * @throws Error if key already registered
   */
  registerFactory(
    chain: string,
    action: string,
    protocol: string,
    factory: (intent: ActionIntent) => ActionBuilder,
  ): void;

  /**
   * Get a builder by exact key. If the key was registered with registerFactory,
   * the intent parameter is required to construct the builder.
   * @throws Error with message: 'No builder registered for key "sui:swap:7k"'
   * @throws Error if factory-registered key is accessed without intent
   */
  get(chain: string, action: string, protocol: string, intent?: ActionIntent): ActionBuilder;

  /**
   * Get the first registered builder for a (chain, action) pair.
   * Used when the caller does not specify a protocol (e.g., no --protocol flag).
   * Selection rule: returns the first builder registered for that (chain, action) pair
   * (insertion order, matching Map iteration order).
   * @throws Error with message: 'No builder registered for "sui:swap"'
   */
  getDefault(chain: string, action: string, intent?: ActionIntent): ActionBuilder;

  has(chain: string, action: string, protocol: string): boolean;
}
```

### MevProtector interface

```typescript
// src/core/mev-protector.ts

interface MevProtector {
  readonly name: string;
  protect(txBytes: Uint8Array, chain: string): Promise<ProtectedTransaction>;
}

interface ProtectedTransaction {
  readonly bytes: Uint8Array;
  readonly metadata: Record<string, unknown>;
}

class NoOpMevProtector implements MevProtector {
  readonly name = 'noop';
  async protect(txBytes: Uint8Array): Promise<ProtectedTransaction> {
    return { bytes: txBytes, metadata: {} };
  }
}
```

### ChainAdapter (refactored)

```typescript
// src/chain/adapter.ts

interface ChainAdapter {
  readonly chain: string;
  getBalance(address: string): Promise<BalanceResult>;
  buildTransactionBytes(transaction: unknown): Promise<Uint8Array>;
  simulate(txBytes: Uint8Array, sender: string): Promise<SimulationResult>;
  signAndSubmit(txBytes: Uint8Array, signer: Signer): Promise<TxResult>;
}
```

Swap-specific methods (`getSwapQuote`, `buildSwapTx`) removed — now handled by `ActionBuilder`.
`simulateTx` renamed to `simulate` (takes raw bytes + sender instead of `TransactionData`).
`signAndSubmit` now takes raw bytes — adapter handles signing internally (see Breaking Interface Changes).

## Section 2: Transaction Pipeline

### PipelineResult

```typescript
// src/core/action-types.ts

type PipelineStatus =
  | 'success'
  | 'simulated'
  | 'rejected'
  | 'simulation_failed'
  | 'error';

interface PipelineResult {
  readonly status: PipelineStatus;
  readonly preview?: ActionPreview;
  readonly txDigest?: string;
  readonly gasUsed?: number;
  readonly amountOut?: string;
  readonly error?: string;
  readonly rejectionCheck?: string;
  readonly rejectionReason?: string;
}
```

### Pipeline function

```typescript
// src/core/transaction-pipeline.ts

interface PipelineInput {
  readonly intent: ActionIntent;      // single generic intent — used by pipeline AND policy
  readonly builder: ActionBuilder;
  readonly chainAdapter: ChainAdapter;
  readonly policyRegistry: PolicyCheckRegistry;
  readonly policyContext: PolicyContext;
  readonly mevProtector: MevProtector;
  readonly tradeLog: TradeLog;
  readonly logger: Logger;
  readonly signer?: Signer;           // undefined = watch-only
  readonly watchOnly: boolean;
}

async function executePipeline(input: PipelineInput): Promise<PipelineResult>
```

The same `intent` flows through the entire pipeline — validation, policy, preview, build, simulate, sign, log. No mapping between intent types needed.

### Pipeline steps

1. `builder.validate(intent)` — throws on bad params
2. `policyRegistry.evaluateAll(intent, policyContext)` — short-circuits on rejection; logs rejected trade
3. `builder.preview(intent)` — fetch quotes from aggregator
4. `builder.build(intent, preview)` — build chain-specific transaction
5. `chainAdapter.buildTransactionBytes(transaction)` — serialize to bytes
6. `chainAdapter.simulate(txBytes, sender)` — dry-run; fail → `simulation_failed`
7. Watch-only check → if true: log trade, return `{ status: 'simulated', preview, gasUsed: simResult.gasEstimate }`
8. `mevProtector.protect(txBytes, chain)` — wrap with MEV protection
9. `chainAdapter.signAndSubmit(protectedBytes, signer)` — sign + submit
10. `tradeLog.logTrade(...)` — record to SQLite, return `success`

Every step wrapped in error handling. No silent failures. Pipeline is a stateless function.

## Section 3: Sui Chain Implementation

### SuiChainAdapter

Ported from `sui-defi-cli/src/chains/sui/sui-adapter.ts`. Methods:

- `getBalance(address)` — `client.getAllBalances()`, map via token map
- `buildTransactionBytes(transaction)` — `(transaction as Transaction).build({ client })`
- `simulate(txBytes, sender)` — `client.dryRunTransactionBlock()`, check status
- `signAndSubmit(txBytes, signer)` — see signature encoding below

Constructor takes RPC URL, creates `SuiClient` (owned by adapter, not a module-level singleton).

**Signature encoding in `signAndSubmit`:**

```typescript
async signAndSubmit(txBytes: Uint8Array, signer: Signer): Promise<TxResult> {
  const rawSignature = await signer.sign(txBytes);
  // Sui serialized signature: [scheme_flag] || [signature (64)] || [public_key (32)] = 97 bytes
  const suiSignature = new Uint8Array(97);
  suiSignature[0] = 0x00;  // Ed25519 scheme flag
  suiSignature.set(rawSignature, 1);
  suiSignature.set(signer.publicKey, 65);
  const signatureB64 = toB64(suiSignature);  // from @mysten/sui/utils

  const result = await this.client.executeTransactionBlock({
    transactionBlock: toB64(txBytes),
    signature: signatureB64,
    options: { showEffects: true, showObjectChanges: true },
  });
  // ... extract txDigest, status, gasUsed from result
}
```

### SuiSwapBuilder

Ported from `sui-defi-cli/src/chains/sui/sui-swap.ts`. Implements `ActionBuilder<SwapIntent>`:

- `builderId = '7k-swap'`
- `chain = 'sui'`
- **Constructed per-trade** (not at bootstrap) — takes `slippageBps` from `intent.params.slippageBps` so the CLI `--slippage` flag is respected. The swap command creates a new `SuiSwapBuilder(intent.params.slippageBps)` for each trade.
- `validate()` — coinTypeIn !== coinTypeOut, amountIn > 0, known tokens
- `preview()` — `metaAg.quote()`, select best by output, return `ActionPreview` with `expectedOutput` set from `best.amountOut` (raw integer string in output token's smallest unit)
- `build()` — `new Transaction()`, `metaAg.swap()`, add transfer move, return `BuiltTransaction`

**Note on per-trade construction:** The `ActionBuilderRegistry` stores a factory function instead of a pre-built instance for builders that need per-trade configuration. See updated bootstrap section.

### SuiNoOpMev

```typescript
class SuiNoOpMev implements MevProtector {
  readonly name = 'sui-noop';
  async protect(txBytes: Uint8Array): Promise<ProtectedTransaction> {
    return { bytes: txBytes, metadata: {} };
  }
}
```

### SuiClient ownership

The `SuiChainAdapter` owns its `SuiClient` instance directly (created in constructor from the RPC URL parameter). No module-level singleton — this avoids silently ignoring RPC URL changes and ensures test isolation.

```typescript
class SuiChainAdapter implements ChainAdapter {
  readonly chain = 'sui';
  private readonly client: SuiClient;

  constructor(rpcUrl: string) {
    this.client = new SuiClient({ url: rpcUrl });
  }
}
```

### New dependency

`@7kprotocol/sdk-ts` — direct dependency. Transitive: `@cetusprotocol/aggregator-sdk`, `@bluefin-exchange/bluefin7k-aggregator-sdk`, `@flowx-finance/sdk`.

### File layout

```
src/chain/sui/
├── adapter.ts             # SuiChainAdapter (rewritten)
├── builder/               # Action builders for Sui chain
│   └── swap-builder.ts    # SuiSwapBuilder (7K Aggregator, new, ported)
├── tokens.ts              # Token map (existing, moved from sui-tokens.ts)
├── client.ts              # SuiClient helpers (no singleton — adapter owns instance)
└── sui-mev.ts             # SuiNoOpMev (new)
```

## Section 4: Watch-Only Wallet

### DB migration

New migration added to `src/db/migrations.ts`:

```sql
ALTER TABLE wallets ADD COLUMN is_watch_only INTEGER NOT NULL DEFAULT 0;
```

Wrapped in try-catch since SQLite lacks `ALTER TABLE ... IF NOT EXISTS`. The catch block must only swallow the specific "duplicate column" error (SQLite error message contains "duplicate column name"); all other errors must be re-thrown to comply with "DO NOT silent any error" (CLAUDE.md).

### Type changes

```typescript
// src/wallet/types.ts

interface WalletInfo {
  // ... existing fields ...
  readonly isWatchOnly: boolean;  // NEW
}

interface WalletRow {
  // ... existing fields ...
  readonly is_watch_only: number;  // NEW
}
```

### Wallet manager changes

Extend existing `registerWalletAddress()` in `src/wallet/manager.ts` with an optional `isWatchOnly` parameter (default `false`) instead of creating a separate function. This avoids a DRY violation:

```typescript
function registerWalletAddress(
  db: Database.Database,
  chain: string,
  address: string,
  isPrimary?: boolean,
  isWatchOnly?: boolean,  // NEW — default false
): void
// INSERT with is_watch_only = isWatchOnly ? 1 : 0
```

Also update the private `insertWallet()` function's SQL to include `is_watch_only` in the INSERT statement, and update all callers (`generateWallet`, `importFromMnemonic`) to pass `isWatchOnly: false` explicitly.

Update `rowToWalletInfo()` to map the new column:

```typescript
function rowToWalletInfo(row: WalletRow): WalletInfo {
  return {
    chain: row.chain,
    address: row.address,
    derivationPath: row.derivation_path,
    isPrimary: row.is_primary === 1,
    isWatchOnly: row.is_watch_only === 1,  // NEW
  };
}
```

### No keystore changes

Watch-only wallets have no private key. No keystore entry created.

### Pipeline behavior

When `watchOnly === true`, pipeline stops after step 6 (simulate):
- Logs trade with `policy_decision: 'approved'`, `tx_digest: 'watch-only'`
- Returns `{ status: 'simulated', preview, gasUsed: simResult.gasEstimate }`
- Skips MEV protection, signing, submission

**Known limitation (MVP):** Watch-only simulations and failed submissions both show `policy_decision: 'approved'` in the trades table. They can be distinguished by `tx_digest` — watch-only trades have `tx_digest = 'watch-only'` while failed submissions have no `tx_digest`. A `trade_mode` column may be added post-MVP if finer granularity is needed.

### CLI command

```
fence wallet watch <address> --chain sui
```

New file `src/cli/commands/wallet-watch.ts`. Validates Sui address format with regex `/^0x[0-9a-fA-F]{64}$/` (32-byte hex). Calls `registerWalletAddress(db, chain, address, false, true)`.

### Watch-only output

```json
{
  "status": "simulated",
  "chain": "sui",
  "action": "swap",
  "fromToken": "SUI",
  "toToken": "USDC",
  "amountIn": "100000000000",
  "expectedOutput": "12500000",
  "provider": "cetus",
  "priceImpact": 0.12,
  "gasEstimate": 2100000
}
```

## Section 5: CLI Wiring & Bootstrap

### Bootstrap changes

`AppComponents` gets two new fields:

```typescript
interface AppComponents {
  // ... existing ...
  readonly actionBuilderRegistry: ActionBuilderRegistry;
  readonly mevProtectors: Map<string, MevProtector>;
}
```

Registration in bootstrap:

```typescript
function buildActionBuilderRegistry(): ActionBuilderRegistry {
  const registry = new ActionBuilderRegistry();
  // SuiSwapBuilder is constructed per-trade (needs slippageBps from intent),
  // so we register a factory that creates the builder on demand.
  // The registry supports both pre-built instances and factory functions.
  registry.registerFactory('sui', 'swap', '7k', (intent: SwapIntent) =>
    new SuiSwapBuilder(intent.params.slippageBps)
  );
  return registry;
}

function buildMevProtectors(): Map<string, MevProtector> {
  const map = new Map<string, MevProtector>();
  map.set('sui', new SuiNoOpMev());
  return map;
}
```

**Note:** `ActionBuilderRegistry` supports two registration modes:
- `register(chain, action, protocol, builder)` — for builders with no per-trade config
- `registerFactory(chain, action, protocol, factory)` — for builders that need per-trade parameters (like slippage). The `getDefault()`/`get()` methods accept an optional `intent` parameter to pass to the factory.

### Swap command rewrite

Current 150-line inline orchestration collapses to:

1. Parse CLI args
2. Resolve wallet, check `isWatchOnly`
3. Resolve token symbols → coin types
4. Build `SwapIntent` (the only intent needed — `ActionIntent` discriminated union)
5. Fetch oracle price → `PolicyContext`
6. Resolve signer (skip if watch-only)
7. `executePipeline({ intent: swapIntent, ... })` → `PipelineResult`
8. Map result → JSON output + exit code

### Signer resolution

New file `src/wallet/signer.ts`:

```typescript
async function resolveSuiSigner(
  wallet: WalletInfo,
  password?: string,
): Promise<Signer>
// Priority:
// 1. SUI_PRIVATE_KEY env var
// 2. SUI_MNEMONIC env var
// 3. Encrypted keystore (loadKeystore + get sui key)
```

### Exit code mapping

| PipelineStatus | Exit Code |
|----------------|-----------|
| `success` | 0 |
| `simulated` | 0 |
| `rejected` | 3 |
| `simulation_failed` | 4 |
| `error` | 1 |

### Output types

Add `SimulatedResponse` to `src/cli/output.ts` and include it in the `CliOutput` union type so `printJsonOutput()` accepts it at compile time:

```typescript
type CliOutput = SuccessResponse | RejectionResponse | ErrorResponse | SimulatedResponse;
```

### Unchanged modules

- `policy/` — refactored: `PolicyCheck.evaluate()` accepts `ActionIntent` instead of `TradeIntent`; checks use discriminant to extract fields
- `config/` — no changes
- `oracle/` — no changes
- `logger/` — no changes
- `telemetry/` — no changes
- `tui/` — no changes

## Testing

| Test File | Coverage |
|-----------|----------|
| `transaction-pipeline.test.ts` | Full flow: success, rejection, simulation failure, watch-only, error |
| `action-builder-registry.test.ts` | Register, registerFactory, get, getDefault, duplicate key, missing key, chain mismatch |
| `sui-swap-builder.test.ts` | validate, preview (mocked MetaAg), build, per-trade slippage |
| `sui-adapter.test.ts` | Update for new interface (buildTransactionBytes, simulate, signAndSubmit with signature encoding) |
| `watch-only.test.ts` | DB migration, registerWalletAddress with isWatchOnly, pipeline stops after simulate with gasEstimate |

## Implementation Layers

Ordered for incremental delivery:

1. **Core types & interfaces** — `src/core/` (action-types with discriminated union, action-builder, mev-protector); delete `TradeIntent` from `src/types/intent.ts`
2. **Policy engine refactor** — update `PolicyCheck`, `PolicyCheckRegistry`, and existing checks to accept `ActionIntent`; use `action` discriminant for field extraction
3. **Sui chain implementation** — port adapter + swap builder (in `builder/` subfolder) + client + mev
4. **Transaction pipeline** — `executePipeline()` with single `ActionIntent` flowing through all steps
5. **Watch-only wallet** — DB migration, wallet types, manager, pipeline branch
6. **CLI wiring** — swap command rewrite, bootstrap, signer, wallet watch command
7. **Integration tests** — end-to-end pipeline tests with mocked RPC
