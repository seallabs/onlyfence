# Perp Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 policy checks for perp operations: market allowlist (default-deny), leverage cap, order size limit, 24h volume limit, and withdrawal limit.

**Architecture:** New `PolicyCheck` implementations plugged into the existing pipeline. No pipeline changes. Config extends `ChainConfig` with `PerpConfig`. `ActivityLogReader` extended for perp volume queries. `PerpProvider` extended with `getTickerPrice` for market price resolution. All checks are chain-agnostic (in `src/policy/checks/`).

**Tech Stack:** TypeScript, Vitest, better-sqlite3, existing PolicyCheck interface

**Spec:** `docs/superpowers/specs/2026-03-28-perp-guardrails-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `src/policy/checks/perp-market-allowlist.ts` | Default-deny market allowlist check |
| `src/policy/checks/perp-leverage-cap.ts` | Leverage cap bounded by config + on-chain max |
| `src/policy/checks/perp-order-size.ts` | Per-order notional USD limit |
| `src/policy/checks/perp-volume.ts` | Rolling 24h perp volume limit |
| `src/policy/checks/perp-withdraw-limit.ts` | Rolling 24h withdrawal limit |
| `src/__tests__/perp-market-allowlist.test.ts` | Tests for market allowlist |
| `src/__tests__/perp-leverage-cap.test.ts` | Tests for leverage cap |
| `src/__tests__/perp-order-size.test.ts` | Tests for order size |
| `src/__tests__/perp-volume.test.ts` | Tests for volume limit |
| `src/__tests__/perp-withdraw-limit.test.ts` | Tests for withdrawal limit |

### Modified files
| File | Changes |
|------|---------|
| `src/types/config.ts` | Add `PerpConfig`, `SecurityConfig` perp ceilings, `perp?` to `ChainConfig` |
| `src/config/schema.ts` | Add validation for `PerpConfig`, perp ceilings, defaults |
| `src/policy/context.ts` | Add `perpMarketPrice?`, `perpMarketMaxLeverage?` |
| `src/db/activity-log.ts` | Add `getRolling24hPerpVolume`, `getRolling24hPerpWithdrawals` to `ActivityLogReader` + `ActivityLog` |
| `src/daemon/trade-window.ts` | Implement new `ActivityLogReader` methods on `InMemoryTradeWindow` |
| `src/core/perp-provider.ts` | Add `getTickerPrice(symbol)` to `PerpProvider` interface |
| `src/chain/sui/bluefin-pro/provider.ts` | Implement `getTickerPrice` via exchange ticker |
| `src/cli/bootstrap.ts` | Register 5 new policy checks in `buildPolicyRegistry` |
| `src/cli/commands/perp.ts` | Resolve `perpMarketPrice` + `perpMarketMaxLeverage` + `tradeValueUsd` before pipeline |
| `src/policy/checks/index.ts` | Export new checks |

---

## Task 1: Config types and validation

**Files:**
- Modify: `src/types/config.ts`
- Modify: `src/config/schema.ts`
- Test: `src/__tests__/security/config-upper-bounds.test.ts` (extend existing)

- [ ] **Step 1: Write failing tests for PerpConfig validation**

Add to `src/__tests__/security/config-upper-bounds.test.ts`:

```typescript
describe('PerpConfig validation', () => {
  it('rejects max_leverage < 1', () => {
    expect(() => validateConfig(makeConfig({ perp: { allowlist_markets: ['SUI-PERP'], max_leverage: 0 } }))).toThrow();
  });

  it('rejects max_leverage above ceiling', () => {
    expect(() => validateConfig(makeConfig({ perp: { allowlist_markets: ['SUI-PERP'], max_leverage: 200 } }))).toThrow(/ceiling/);
  });

  it('accepts valid perp config', () => {
    const cfg = validateConfig(makeConfig({
      perp: { allowlist_markets: ['SUI-PERP'], max_leverage: 10, max_single_order: 500, max_24h_volume: 5000, max_24h_withdraw: 1000 }
    }));
    expect(cfg.chain.sui.perp?.max_leverage).toBe(10);
  });

  it('accepts absent perp config', () => {
    const cfg = validateConfig(makeConfig({}));
    expect(cfg.chain.sui.perp).toBeUndefined();
  });

  it('rejects empty string in allowlist_markets', () => {
    expect(() => validateConfig(makeConfig({ perp: { allowlist_markets: [''] } }))).toThrow();
  });

  it('rejects duplicate entries in allowlist_markets', () => {
    expect(() => validateConfig(makeConfig({ perp: { allowlist_markets: ['SUI-PERP', 'SUI-PERP'] } }))).toThrow(/duplicate/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/security/config-upper-bounds.test.ts
```

- [ ] **Step 3: Add PerpConfig to types/config.ts**

```typescript
export interface PerpConfig {
  readonly allowlist_markets?: readonly string[];
  readonly max_leverage?: number;
  readonly max_single_order?: number;
  readonly max_24h_volume?: number;
  readonly max_24h_withdraw?: number;
}
```

Add to `ChainConfig`: `readonly perp?: PerpConfig;`

Add to `SecurityConfig`:
```typescript
readonly max_perp_leverage_ceiling?: number;
readonly max_perp_single_order_ceiling?: number;
readonly max_perp_24h_volume_ceiling?: number;
readonly max_perp_24h_withdraw_ceiling?: number;
```

- [ ] **Step 4: Add validation in schema.ts**

Add constants:
```typescript
export const DEFAULT_MAX_PERP_LEVERAGE_CEILING = 100;
export const DEFAULT_MAX_PERP_SINGLE_ORDER_CEILING = 100_000;
export const DEFAULT_MAX_PERP_24H_VOLUME_CEILING = 1_000_000;
export const DEFAULT_MAX_PERP_24H_WITHDRAW_CEILING = 100_000;
```

Add `validatePerpConfig` function following the `validateLimits` pattern. Add perp ceiling fields to `validateSecurityConfig`. Wire `validatePerpConfig` into `validateChainConfig`.

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/__tests__/security/config-upper-bounds.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/types/config.ts src/config/schema.ts src/__tests__/security/config-upper-bounds.test.ts
git commit -m "feat(guardrails): add PerpConfig type and validation with security ceilings"
```

---

## Task 2: PolicyContext extensions

**Files:**
- Modify: `src/policy/context.ts`

- [ ] **Step 1: Add perp fields to PolicyContext**

```typescript
export interface PolicyContext {
  readonly config: ChainConfig;
  readonly activityLog: ActivityLogReader;
  readonly tradeValueUsd?: number;
  /** Last price from exchange ticker (USD) — for perp notional calculations */
  readonly perpMarketPrice?: number;
  /** On-chain max leverage for this market — for leverage cap check */
  readonly perpMarketMaxLeverage?: number;
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/policy/context.ts
git commit -m "feat(guardrails): extend PolicyContext with perpMarketPrice and perpMarketMaxLeverage"
```

---

## Task 3: ActivityLogReader extensions

**Files:**
- Modify: `src/db/activity-log.ts`
- Modify: `src/daemon/trade-window.ts`
- Test: `src/__tests__/activity-log.test.ts` (extend existing)

- [ ] **Step 1: Write failing tests**

Add to `src/__tests__/activity-log.test.ts`:

```typescript
describe('perp volume queries', () => {
  it('getRolling24hPerpVolume returns sum of approved perp:place_order value_usd', () => {
    activityLog.logActivity({
      chain_id: 'sui:mainnet', wallet_address: '0xabc', action: 'perp:place_order',
      policy_decision: 'approved', value_usd: 100,
    });
    activityLog.logActivity({
      chain_id: 'sui:mainnet', wallet_address: '0xabc', action: 'perp:place_order',
      policy_decision: 'approved', value_usd: 200,
    });
    expect(activityLog.getRolling24hPerpVolume('sui:mainnet')).toBe(300);
  });

  it('getRolling24hPerpVolume excludes rejected orders', () => {
    activityLog.logActivity({
      chain_id: 'sui:mainnet', wallet_address: '0xabc', action: 'perp:place_order',
      policy_decision: 'rejected', value_usd: 500,
    });
    expect(activityLog.getRolling24hPerpVolume('sui:mainnet')).toBe(0);
  });

  it('getRolling24hPerpWithdrawals returns sum of approved perp:withdraw value_usd', () => {
    activityLog.logActivity({
      chain_id: 'sui:mainnet', wallet_address: '0xabc', action: 'perp:withdraw',
      policy_decision: 'approved', value_usd: 50,
    });
    expect(activityLog.getRolling24hPerpWithdrawals('sui:mainnet')).toBe(50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/activity-log.test.ts
```

- [ ] **Step 3: Implement**

Add to `ActivityLogReader` interface:
```typescript
getRolling24hPerpVolume(chainId: ChainId): number;
getRolling24hPerpWithdrawals(chainId: ChainId): number;
```

Add to `ActivityLog` class:
```typescript
private readonly rolling24hPerpVolumeStmt: Statement;
private readonly rolling24hPerpWithdrawStmt: Statement;

// In constructor:
this.rolling24hPerpVolumeStmt = db.prepare(`
  SELECT COALESCE(SUM(value_usd), 0) as total FROM activities
  WHERE chain_id = ? AND action = 'perp:place_order'
  AND policy_decision = 'approved'
  AND created_at > datetime('now', '-24 hours')
`);
this.rolling24hPerpWithdrawStmt = db.prepare(`
  SELECT COALESCE(SUM(value_usd), 0) as total FROM activities
  WHERE chain_id = ? AND action = 'perp:withdraw'
  AND policy_decision = 'approved'
  AND created_at > datetime('now', '-24 hours')
`);
```

Add to `InMemoryTradeWindow`:
```typescript
getRolling24hPerpVolume(_chainId: ChainId): number {
  // Filter entries by perp:place_order within 24h window
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return this.entries
    .filter(e => e.action === 'perp:place_order' && e.timestamp > cutoff)
    .reduce((sum, e) => sum + e.valueUsd, 0);
}

getRolling24hPerpWithdrawals(_chainId: ChainId): number {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return this.entries
    .filter(e => e.action === 'perp:withdraw' && e.timestamp > cutoff)
    .reduce((sum, e) => sum + e.valueUsd, 0);
}
```

**Important:** `InMemoryTradeWindow.TradeEntry` currently only has `chainId`, `valueUsd`, `timestamp`. It needs an `action` field added:

```typescript
interface TradeEntry {
  readonly chainId: string;
  readonly valueUsd: number;
  readonly timestamp: number;
  readonly action?: string;  // NEW: needed for perp volume/withdrawal filtering
}
```

The `record()` method signature must also be extended:
```typescript
record(chainId: string, valueUsd: number, action?: string): void {
  this.entries.push({ chainId, valueUsd, timestamp: Date.now(), action });
  // ... existing pruning logic
}
```

Callers of `record()` (in `src/daemon/executor.ts` or `src/daemon/server.ts`) need to pass the action. Check all callers with: `grep -rn 'tradeWindow.record\|\.record(' src/daemon/`. Update each caller to pass the action from the pipeline result.

The `preload()` method should also be extended to preload perp volume/withdrawals separately from swap volume, since they use different action filters.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/__tests__/activity-log.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/db/activity-log.ts src/daemon/trade-window.ts src/__tests__/activity-log.test.ts
git commit -m "feat(guardrails): add perp volume and withdrawal queries to ActivityLogReader"
```

---

## Task 4: PerpProvider.getTickerPrice

**Files:**
- Modify: `src/core/perp-provider.ts`
- Modify: `src/chain/sui/bluefin-pro/provider.ts`
- Modify: `src/chain/sui/bluefin-pro/client.ts`
- Test: `src/__tests__/perp-improvements.test.ts` (extend existing)

- [ ] **Step 1: Add getTickerPrice to PerpProvider interface**

```typescript
/** Get the last traded price for a market from the exchange ticker. */
getTickerPrice(marketSymbol: string): Promise<number>;
```

- [ ] **Step 2: Add getTicker to BluefinClient**

Check the SDK for ticker methods. The SDK should have `exchangeDataApi.getTicker(symbol)` or similar. Add:

```typescript
async getTicker(symbol: string): Promise<{ lastPriceE9: string; markPriceE9: string }> {
  await this.ensureInitialized();
  const response = await this.sdk.exchangeDataApi.getTicker(symbol);
  return response.data;
}
```

- [ ] **Step 3: Implement getTickerPrice in BluefinPerpProvider**

```typescript
async getTickerPrice(marketSymbol: string): Promise<number> {
  const ticker = await this.client.getTicker(marketSymbol);
  return fromE9(ticker.lastPriceE9);
}
```

- [ ] **Step 4: Write test**

```typescript
it('getTickerPrice returns last price from exchange ticker', async () => {
  mockClient.getTicker = vi.fn().mockResolvedValue({ lastPriceE9: '3800000000', markPriceE9: '3800000000' });
  const price = await provider.getTickerPrice('SUI-PERP');
  expect(price).toBe(3.8);
});
```

- [ ] **Step 5: Run tests and typecheck**

```bash
npx tsc --noEmit && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add src/core/perp-provider.ts src/chain/sui/bluefin-pro/provider.ts src/chain/sui/bluefin-pro/client.ts src/__tests__/perp-improvements.test.ts
git commit -m "feat(guardrails): add getTickerPrice to PerpProvider for perp market price resolution"
```

---

## Task 5: Test helper extensions

**Files:**
- Modify: `src/__tests__/helpers.ts`

- [ ] **Step 1: Extend createContext to accept perp fields**

```typescript
export function createContext(
  config: ChainConfig,
  db: Database.Database,
  tradeValueUsd?: number,
  perpFields?: {
    perpMarketPrice?: number;
    perpMarketMaxLeverage?: number;
  },
): PolicyContext {
  return {
    config,
    activityLog: new ActivityLog(db),
    ...(tradeValueUsd !== undefined ? { tradeValueUsd } : {}),
    ...perpFields,
  };
}
```

Existing callers pass 2-3 args — backward compatible (new params are optional).

- [ ] **Step 2: Add createPerpPlaceOrderIntent helper**

```typescript
export function createPerpPlaceOrderIntent(overrides?: Partial<PerpPlaceOrderIntent['params']>): PerpPlaceOrderIntent {
  return {
    action: 'perp:place_order',
    chainId: 'sui:mainnet',
    walletAddress: '0x' + 'a'.repeat(64),
    params: {
      marketSymbol: 'SUI-PERP',
      side: 'LONG',
      quantityE9: '1000000000',
      orderType: 'LIMIT',
      limitPriceE9: '5000000000',
      leverageE9: '5000000000',
      collateralCoinType: '0xusdc::usdc::USDC',
      marketCoinType: '0xbf1bef::bluefin_pro::SUI',
      ...overrides,
    },
  };
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/__tests__/helpers.ts
git commit -m "test: extend helpers with perp PolicyContext and intent factories"
```

---

## Task 6: PerpMarketAllowlistCheck

**Files:**
- Create: `src/policy/checks/perp-market-allowlist.ts`
- Test: `src/__tests__/perp-market-allowlist.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
1. Pass: `perp:place_order` with market in allowlist
2. Reject: `perp:place_order` with market NOT in allowlist (default-deny)
3. Reject: `perp:place_order` when `perp` config absent
4. Reject: `perp:place_order` when `allowlist_markets` is empty
5. Pass: `perp:cancel_order` always passes (even for de-listed markets)
6. Pass: `perp:deposit` when allowlist is non-empty (perp enabled)
7. Reject: `perp:deposit` when config absent
8. Pass: `perp:withdraw` always passes
9. Pass: `trade:swap` passes through (non-perp action)

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/perp-market-allowlist.test.ts
```

- [ ] **Step 3: Implement the check**

Follow `TokenAllowlistCheck` pattern. Key logic:
```typescript
evaluate(intent: ActionIntent, ctx: PolicyContext): Promise<CheckResult> {
  // Non-perp actions: pass through
  if (!intent.action.startsWith('perp:')) return pass();

  // Cancel and withdraw: always allowed
  if (intent.action === 'perp:cancel_order' || intent.action === 'perp:withdraw') return pass();

  const perpConfig = ctx.config.perp;
  const markets = perpConfig?.allowlist_markets;

  // Deposit: passes if perp is enabled (non-empty allowlist)
  if (intent.action === 'perp:deposit') {
    if (markets === undefined || markets.length === 0) return reject('perp_not_enabled', ...);
    return pass();
  }

  // place_order: check market against allowlist
  if (markets === undefined || markets.length === 0) return reject('perp_not_enabled', ...);
  const marketSymbol = intent.params.marketSymbol;
  if (!markets.includes(marketSymbol)) return reject('market_not_allowed', ...);
  return pass();
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/__tests__/perp-market-allowlist.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/policy/checks/perp-market-allowlist.ts src/__tests__/perp-market-allowlist.test.ts
git commit -m "feat(guardrails): add PerpMarketAllowlistCheck (default-deny)"
```

---

## Task 7: PerpLeverageCapCheck

**Files:**
- Create: `src/policy/checks/perp-leverage-cap.ts`
- Test: `src/__tests__/perp-leverage-cap.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
1. Pass: leverage within config cap and on-chain max
2. Reject: leverage exceeds config cap (config < on-chain)
3. Reject: leverage exceeds on-chain max (on-chain < config)
4. Pass: no `max_leverage` in config (check passes, builder still validates on-chain)
5. Pass: no explicit leverage in intent (auto-resolved by builder, check passes)
6. Pass: non-perp action passes through
7. Pass: `perp:cancel_order` passes through

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement**

Key logic: `effectiveCap = min(config.max_leverage, ctx.perpMarketMaxLeverage)`. Compare `fromE9(intent.params.leverageE9)` against `effectiveCap`.

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add src/policy/checks/perp-leverage-cap.ts src/__tests__/perp-leverage-cap.test.ts
git commit -m "feat(guardrails): add PerpLeverageCapCheck bounded by config + on-chain max"
```

---

## Task 8: PerpOrderSizeCheck

**Files:**
- Create: `src/policy/checks/perp-order-size.ts`
- Test: `src/__tests__/perp-order-size.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
1. Pass: limit order notional within limit
2. Reject: limit order notional exceeds limit
3. Pass: market order notional within limit (uses perpMarketPrice)
4. Reject: market order notional exceeds limit
5. Pass: market order when perpMarketPrice unavailable (permissive with warning)
6. Pass: no `max_single_order` in config
7. Pass: non-perp action passes through

Notional = `(priceE9 / 1e9) * (quantityE9 / 1e9)` for limit; `perpMarketPrice * (quantityE9 / 1e9)` for market.

- [ ] **Step 2-5: Implement, test, commit**

```bash
git commit -m "feat(guardrails): add PerpOrderSizeCheck for per-order notional limit"
```

---

## Task 9: PerpVolumeCheck

**Files:**
- Create: `src/policy/checks/perp-volume.ts`
- Test: `src/__tests__/perp-volume.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
1. Pass: projected volume within limit
2. Reject: projected volume exceeds limit
3. Pass: no `max_24h_volume` in config
4. Pass: non-perp action passes through
5. Reject with correct detail message showing current + requested + limit

Add a code comment explaining why `perp:place_order` rows are counted instead of `perp:filled` rows:
```
// NOTE: Volume is counted from perp:place_order (intent), not perp:filled (actual fills).
// This is conservative — orders rejected by the exchange after pipeline approval still count.
// This avoids depending on `fence perp sync` being called for fill-based tracking.
// Trade-off: over-counts when exchange rejects orders, but safer than under-counting.
```

- [ ] **Step 2-5: Implement, test, commit**

```bash
git commit -m "feat(guardrails): add PerpVolumeCheck for rolling 24h perp volume limit"
```

---

## Task 10: PerpWithdrawLimitCheck

**Files:**
- Create: `src/policy/checks/perp-withdraw-limit.ts`
- Test: `src/__tests__/perp-withdraw-limit.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
1. Pass: projected withdrawal within limit
2. Reject: projected withdrawal exceeds limit
3. Pass: no `max_24h_withdraw` in config
4. Pass: tradeValueUsd unavailable (permissive)
5. Pass: non-perp action passes through
6. Pass: non-withdraw perp action passes through

- [ ] **Step 2-5: Implement, test, commit**

```bash
git commit -m "feat(guardrails): add PerpWithdrawLimitCheck for rolling 24h withdrawal limit"
```

---

## Task 11: Register checks and wire CLI

**Files:**
- Modify: `src/cli/bootstrap.ts`
- Modify: `src/cli/commands/perp.ts`
- Modify: `src/policy/checks/index.ts`

- [ ] **Step 1: Export new checks from index**

Add to `src/policy/checks/index.ts`:
```typescript
export { PerpMarketAllowlistCheck } from './perp-market-allowlist.js';
export { PerpLeverageCapCheck } from './perp-leverage-cap.js';
export { PerpOrderSizeCheck } from './perp-order-size.js';
export { PerpVolumeCheck } from './perp-volume.js';
export { PerpWithdrawLimitCheck } from './perp-withdraw-limit.js';
```

- [ ] **Step 2: Register in bootstrap.ts**

In `buildPolicyRegistry`:
```typescript
registry.register(new PerpMarketAllowlistCheck());
registry.register(new PerpLeverageCapCheck());
registry.register(new PerpOrderSizeCheck());
registry.register(new PerpVolumeCheck());
registry.register(new PerpWithdrawLimitCheck());
```

- [ ] **Step 3: Extend `preparePipeline` to accept optional perp context fields**

The current `preparePipeline` function builds `PolicyContext` internally. It must be extended to pass through perp-specific fields:

```typescript
// In preparePipeline, add optional params:
function preparePipeline(
  components: AppComponents,
  chain: Chain,
  intent: ActionIntent,
  options?: {
    tradeValueUsd?: number;
    perpMarketPrice?: number;
    perpMarketMaxLeverage?: number;
  },
): PipelineInput {
  // ... existing code
  const policyCtx: PolicyContext = {
    config: chainConfig,
    activityLog: components.activityLog,
    ...(options?.tradeValueUsd !== undefined ? { tradeValueUsd: options.tradeValueUsd } : {}),
    ...(options?.perpMarketPrice !== undefined ? { perpMarketPrice: options.perpMarketPrice } : {}),
    ...(options?.perpMarketMaxLeverage !== undefined ? { perpMarketMaxLeverage: options.perpMarketMaxLeverage } : {}),
  };
  // ... rest of function
}
```

Then in `registerOrderAction`, resolve and pass:
```typescript
let perpMarketPrice: number | undefined;
try {
  perpMarketPrice = await provider.getTickerPrice(marketSymbol);
} catch {
  // Price unavailable — order size check will pass with warning
}
const markets = await provider.getMarkets();
const marketInfo = markets.find(m => m.symbol === marketSymbol);
const perpMarketMaxLeverage = marketInfo !== undefined ? fromE9(marketInfo.maxLeverageE9) : undefined;
const tradeValueUsd = perpMarketPrice !== undefined ? perpMarketPrice * fromE9(quantityE9) : undefined;

const pipelineInput = preparePipeline(components, chain, intent, {
  tradeValueUsd,
  perpMarketPrice,
  perpMarketMaxLeverage,
});
```

In `registerWithdrawAction`, pass `tradeValueUsd`:
```typescript
const tradeValueUsd = parseFloat(amountStr);
const pipelineInput = preparePipeline(components, chain, intent, { tradeValueUsd });
```

Existing callers (swap, lending, deposit, cancel) pass no options — backward compatible.

- [ ] **Step 4: Typecheck and run all tests**

```bash
npx tsc --noEmit && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/bootstrap.ts src/cli/commands/perp.ts src/policy/checks/index.ts
git commit -m "feat(guardrails): register perp policy checks and wire PolicyContext in CLI"
```

---

## Task 12: Integration test and final verification

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Lint**

```bash
npx eslint src/
```

- [ ] **Step 4: Verify default config works (no perp section = all perp blocked)**

Verify that a config without `[chain.sui.perp]` causes all perp orders to be rejected by `perp_market_allowlist`.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: lint and integration fixes for perp guardrails"
```
