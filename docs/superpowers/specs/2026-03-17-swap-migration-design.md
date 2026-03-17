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
  ├─ Parse args → SwapIntent + TradeIntent
  ├─ Resolve wallet (check isWatchOnly)
  ├─ Fetch oracle price → PolicyContext
  ├─ Resolve signer (skip if watch-only)
  |
  └─ executePipeline(PipelineInput)
       |
       ├─ 1. builder.validate(intent)
       ├─ 2. policyRegistry.evaluateAll(tradeIntent, ctx)  ← existing policy engine
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
│   ├── action-types.ts                # ActionIntent, SwapIntent, ActionPreview, PipelineResult
│   ├── action-builder.ts              # ActionBuilder interface + ActionBuilderRegistry
│   ├── transaction-pipeline.ts        # executePipeline() function
│   └── mev-protector.ts              # MevProtector interface + NoOpMevProtector
├── chain/                             # EXISTING — refactored
│   ├── adapter.ts                     # ChainAdapter interface (trimmed: no swap methods)
│   ├── factory.ts                     # ChainAdapterFactory (existing, unchanged)
│   └── sui/                           # Per-chain subdirectory
│       ├── adapter.ts                 # SuiChainAdapter (working impl)
│       ├── sui-swap-builder.ts        # SuiSwapBuilder (7K Aggregator)
│       ├── tokens.ts                  # Token map (existing, moved)
│       ├── client.ts                  # Singleton SuiClient factory
│       └── sui-mev.ts                # SuiNoOpMev placeholder
├── wallet/                            # EXISTING — extended
│   ├── manager.ts                     # Add registerWatchOnlyWallet()
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
├── policy/                            # UNCHANGED
├── config/                            # UNCHANGED
├── oracle/                            # UNCHANGED
└── logger/                            # UNCHANGED
```

## Section 1: Core Types & Interfaces

### ActionIntent hierarchy

```typescript
// src/core/action-types.ts

type DeFiAction = 'swap' | 'lp_deposit' | 'lp_withdraw';

interface ActionIntent {
  readonly chain: string;
  readonly action: DeFiAction;
  readonly walletAddress: string;
  readonly params: Record<string, unknown>;
}

interface SwapIntent extends ActionIntent {
  readonly action: 'swap';
  readonly params: {
    readonly coinTypeIn: string;
    readonly coinTypeOut: string;
    readonly amountIn: string;
    readonly slippageBps: number;
  };
}
```

Existing `TradeIntent` stays as policy engine input. The swap command maps `SwapIntent` → `TradeIntent` for policy evaluation.

### ActionBuilder interface

```typescript
// src/core/action-builder.ts

interface ActionPreview {
  readonly description: string;
  readonly expectedOutput: string;
  readonly provider: string;
  readonly priceImpact?: number;
  readonly buildData: unknown;
}

interface ActionBuilder<T extends ActionIntent = ActionIntent> {
  readonly builderId: string;
  validate(intent: T): void;
  preview(intent: T): Promise<ActionPreview>;
  build(intent: T, preview: ActionPreview): Promise<BuiltTransaction>;
}

interface BuiltTransaction {
  readonly transaction: unknown;
  readonly metadata: Record<string, unknown>;
}
```

### ActionBuilderRegistry

```typescript
// src/core/action-builder.ts

type BuilderKey = `${string}:${string}:${string}`;  // "sui:swap:7k"

class ActionBuilderRegistry {
  private readonly builders = new Map<BuilderKey, ActionBuilder>();

  register(chain: string, action: string, protocol: string, builder: ActionBuilder): void;
  get(chain: string, action: string, protocol: string): ActionBuilder;
  getDefault(chain: string, action: string): ActionBuilder;
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
  readonly intent: ActionIntent;
  readonly builder: ActionBuilder;
  readonly chainAdapter: ChainAdapter;
  readonly policyRegistry: PolicyCheckRegistry;
  readonly policyContext: PolicyContext;
  readonly mevProtector: MevProtector;
  readonly tradeLog: TradeLog;
  readonly logger: Logger;
  readonly signer?: Signer;
  readonly watchOnly: boolean;
}

async function executePipeline(input: PipelineInput): Promise<PipelineResult>
```

### Pipeline steps

1. `builder.validate(intent)` — throws on bad params
2. `policyRegistry.evaluateAll(tradeIntent, policyContext)` — short-circuits on rejection
3. `builder.preview(intent)` — fetch quotes from aggregator
4. `builder.build(intent, preview)` — build chain-specific transaction
5. `chainAdapter.buildTransactionBytes(transaction)` — serialize to bytes
6. `chainAdapter.simulate(txBytes, sender)` — dry-run; fail → `simulation_failed`
7. Watch-only check → if true: log trade, return `simulated`
8. `mevProtector.protect(txBytes, chain)` — wrap with MEV protection
9. `chainAdapter.signAndSubmit(protectedBytes, signer)` — sign + submit
10. `tradeLog.logTrade(...)` — record to SQLite, return `success`

Every step wrapped in error handling. No silent failures. Pipeline is a stateless function.

### TradeIntent mapping

The pipeline receives `ActionIntent` but the policy engine expects `TradeIntent`. The swap command constructs both — the pipeline receives a `PolicyContext` that's already built with the right `TradeIntent`. The pipeline calls `policyRegistry.evaluateAll(tradeIntent, ctx)` where `tradeIntent` is derived from the `ActionIntent` by the caller.

**Alternative considered:** Having the pipeline do the mapping internally. Rejected because different actions (swap vs LP) map differently to `TradeIntent`, and the caller already has the context to do this correctly.

Updated pipeline input:

```typescript
interface PipelineInput {
  // ... same as above, plus:
  readonly tradeIntent: TradeIntent;  // pre-built by caller for policy evaluation
}
```

## Section 3: Sui Chain Implementation

### SuiChainAdapter

Ported from `sui-defi-cli/src/chains/sui/sui-adapter.ts`. Methods:

- `getBalance(address)` — `client.getAllBalances()`, map via token map
- `buildTransactionBytes(transaction)` — `(transaction as Transaction).build({ client })`
- `simulate(txBytes, sender)` — `client.dryRunTransactionBlock()`, check status
- `signAndSubmit(txBytes, signer)` — `signer.sign()` + `client.executeTransactionBlock()`, wait for finality

Constructor takes RPC URL, creates `SuiClient` via singleton factory.

### SuiSwapBuilder

Ported from `sui-defi-cli/src/chains/sui/sui-swap.ts`. Implements `ActionBuilder<SwapIntent>`:

- `builderId = '7k-swap'`
- Constructor takes `slippageBps`, creates `MetaAg` with Cetus/Bluefin/FlowX providers
- `validate()` — coinTypeIn !== coinTypeOut, amountIn > 0, known tokens
- `preview()` — `metaAg.quote()`, select best by output, return `ActionPreview`
- `build()` — `new Transaction()`, `metaAg.swap()`, add transfer move, return `BuiltTransaction`

### SuiNoOpMev

```typescript
class SuiNoOpMev implements MevProtector {
  readonly name = 'sui-noop';
  async protect(txBytes: Uint8Array): Promise<ProtectedTransaction> {
    return { bytes: txBytes, metadata: {} };
  }
}
```

### Singleton SuiClient

```typescript
// src/chain/sui/client.ts
let cachedClient: SuiClient | null = null;

function getSuiClient(rpcUrl: string): SuiClient {
  if (!cachedClient) {
    cachedClient = new SuiClient({ url: rpcUrl });
  }
  return cachedClient;
}
```

### New dependency

`@7kprotocol/sdk-ts` — direct dependency. Transitive: `@cetusprotocol/aggregator-sdk`, `@bluefin-exchange/bluefin7k-aggregator-sdk`, `@flowx-finance/sdk`.

### File layout

```
src/chain/sui/
├── adapter.ts             # SuiChainAdapter (rewritten)
├── sui-swap-builder.ts    # SuiSwapBuilder (new, ported)
├── tokens.ts              # Token map (existing, moved from sui-tokens.ts)
├── client.ts              # Singleton SuiClient (new)
└── sui-mev.ts             # SuiNoOpMev (new)
```

## Section 4: Watch-Only Wallet

### DB migration

New migration added to `src/db/migrations.ts`:

```sql
ALTER TABLE wallets ADD COLUMN is_watch_only INTEGER NOT NULL DEFAULT 0;
```

Wrapped in try-catch since SQLite lacks `ALTER TABLE ... IF NOT EXISTS`. If column already exists, error is caught and ignored.

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

### New wallet function

```typescript
// src/wallet/manager.ts

function registerWatchOnlyWallet(
  db: Database.Database,
  chain: string,
  address: string,
): void
// INSERT with is_watch_only = 1, derivation_path = NULL
```

### No keystore changes

Watch-only wallets have no private key. No keystore entry created.

### Pipeline behavior

When `watchOnly === true`, pipeline stops after step 6 (simulate):
- Logs trade with `policy_decision: 'approved'`
- Returns `{ status: 'simulated', preview }`
- Skips MEV protection, signing, submission

### CLI command

```
fence wallet watch <address> --chain sui
```

New file `src/cli/commands/wallet-watch.ts`. Validates address format, calls `registerWatchOnlyWallet()`.

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
function buildActionBuilderRegistry(slippageBps: number): ActionBuilderRegistry {
  const registry = new ActionBuilderRegistry();
  registry.register('sui', 'swap', '7k', new SuiSwapBuilder(slippageBps));
  return registry;
}

function buildMevProtectors(): Map<string, MevProtector> {
  const map = new Map<string, MevProtector>();
  map.set('sui', new SuiNoOpMev());
  return map;
}
```

### Swap command rewrite

Current 150-line inline orchestration collapses to:

1. Parse CLI args
2. Resolve wallet, check `isWatchOnly`
3. Resolve token symbols → coin types
4. Build `SwapIntent` + `TradeIntent`
5. Fetch oracle price → `PolicyContext`
6. Resolve signer (skip if watch-only)
7. `executePipeline(...)` → `PipelineResult`
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

Add `SimulatedResponse` to `src/cli/output.ts` for watch-only results.

### Unchanged modules

- `policy/` — no changes
- `config/` — no changes
- `oracle/` — no changes
- `logger/` — no changes
- `telemetry/` — no changes
- `tui/` — no changes

## Testing

| Test File | Coverage |
|-----------|----------|
| `transaction-pipeline.test.ts` | Full flow: success, rejection, simulation failure, watch-only, error |
| `action-builder-registry.test.ts` | Register, get, getDefault, duplicate key, missing key |
| `sui-swap-builder.test.ts` | validate, preview (mocked MetaAg), build |
| `sui-adapter.test.ts` | Update for new interface (buildTransactionBytes, simulate, signAndSubmit) |
| `watch-only.test.ts` | DB migration, registerWatchOnlyWallet, pipeline stops after simulate |

## Implementation Layers

Ordered for incremental delivery:

1. **Core types & interfaces** — `src/core/` (action-types, action-builder, mev-protector)
2. **Sui chain implementation** — port adapter + swap builder + client + mev
3. **Transaction pipeline** — `executePipeline()` with policy integration
4. **Watch-only wallet** — DB migration, wallet types, manager, pipeline branch
5. **CLI wiring** — swap command rewrite, bootstrap, signer, wallet watch command
6. **Integration tests** — end-to-end pipeline tests with mocked RPC
