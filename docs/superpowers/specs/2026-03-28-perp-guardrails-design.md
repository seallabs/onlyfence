# Perp Guardrails Design Spec

## Goal

Add 5 policy checks for perpetual futures operations: market allowlist (default-deny), leverage cap, single order size limit, 24h volume limit, and withdrawal limit. All checks use the existing `PolicyCheck` pipeline — no pipeline changes needed.

## Config Schema

New `[chain.sui.perp]` section in `config.toml`, separate from spot/lending config:

```toml
[chain.sui.perp]
# Markets the agent is allowed to trade.
# DEFAULT-DENY: if this section is absent or empty, ALL perp orders are blocked.
# The agent must be explicitly granted access to each market.
allowlist_markets = ["SUI-PERP", "BTC-PERP", "ETH-PERP"]

# Max leverage the agent can use (global, all markets).
# Bounded by the on-chain market max — the lower of config vs on-chain wins.
# Absent = no config-level cap (on-chain max still applies via builder validation).
max_leverage = 10

# Max notional value per individual order in USD (price × qty).
# Absent = no per-order limit.
max_single_order = 500

# Max rolling 24h perp trading volume in USD.
# NOTE: Counts perp:place_order approved rows, not actual fills. This means
# orders that were accepted by the pipeline but rejected by the exchange still
# count toward the limit. This is conservative (over-counts) but does not
# depend on `fence perp sync` being called. Actual fill-based tracking would
# require syncing fills first, which is not guaranteed.
# Absent = no volume limit.
max_24h_volume = 5000

# Max rolling 24h withdrawal from margin bank in USD.
# Absent = no withdrawal limit.
max_24h_withdraw = 1000
```

TypeScript type:

```typescript
export interface PerpConfig {
  readonly allowlist_markets?: readonly string[];
  readonly max_leverage?: number;        // must be >= 1, ceiling: 100
  readonly max_single_order?: number;    // must be > 0, ceiling: 100000
  readonly max_24h_volume?: number;      // must be > 0, ceiling: 1000000
  readonly max_24h_withdraw?: number;    // must be > 0, ceiling: 100000
}
```

Added to `ChainConfig` as `readonly perp?: PerpConfig`.

**Config validation rules** (in `schema.ts`):
- `allowlist_markets`: array of non-empty strings, no duplicates
- `max_leverage`: >= 1, <= `SecurityConfig.max_perp_leverage_ceiling` (default 100)
- `max_single_order`: > 0, <= `SecurityConfig.max_perp_single_order_ceiling` (default 100000)
- `max_24h_volume`: > 0, <= `SecurityConfig.max_perp_24h_volume_ceiling` (default 1000000)
- `max_24h_withdraw`: > 0, <= `SecurityConfig.max_perp_24h_withdraw_ceiling` (default 100000)

**SecurityConfig extensions:**
```typescript
export interface SecurityConfig {
  // ... existing spot ceilings
  readonly max_perp_leverage_ceiling?: number;          // default: 100
  readonly max_perp_single_order_ceiling?: number;      // default: 100000
  readonly max_perp_24h_volume_ceiling?: number;        // default: 1000000
  readonly max_perp_24h_withdraw_ceiling?: number;      // default: 100000
}
```

**Behavior when config is absent:**
- No `[chain.sui.perp]` section → `perp` is `undefined` → market allowlist rejects all perp orders
- Individual limits absent (e.g., no `max_leverage`) → that specific check passes
- Market allowlist is the only mandatory check — it's the gate that enables perp trading

## Policy Checks

5 new `PolicyCheck` implementations registered in this order (after existing checks):

### 1. PerpMarketAllowlistCheck (`perp_market_allowlist`)

- **Applies to:** `perp:place_order` (checks market against allowlist)
- **Passes when:** Market symbol is in `perp.allowlist_markets`
- **Rejects when:** Market not in list, list is empty, or config absent (default-deny)
- **Pass-through:** All non-perp actions (swap, lending, etc.)
- **`perp:cancel_order`:** Always passes — users must be able to cancel orders on de-listed markets to unwind positions. Blocking cancel on a removed market traps the user.
- **`perp:deposit`:** Passes if `perp.allowlist_markets` is a non-empty array (perp is enabled). Rejects if config absent or empty. Deposit has no market field.
- **`perp:withdraw`:** Always passes — users must be able to withdraw margin regardless of allowlist state. Blocking withdrawal is a safety hazard.

### 2. PerpLeverageCapCheck (`perp_leverage_cap`)

- **Applies to:** `perp:place_order`
- **Passes when:** `config.perp.max_leverage` is absent, or intent leverage ≤ `min(config.max_leverage, on-chain market max)`
- **Rejects when:** Leverage exceeds the lower of config cap vs on-chain max
- **Context needed:** `PolicyContext.perpMarketMaxLeverage` (resolved at CLI boundary from market info)
- **Note:** The builder already validates against on-chain max. This check adds the user's config cap on top.

### 3. PerpOrderSizeCheck (`perp_order_size`)

- **Applies to:** `perp:place_order`
- **Passes when:** `config.perp.max_single_order` is absent, or order notional ≤ limit
- **Rejects when:** Order notional exceeds `max_single_order`
- **Notional calculation:**
  - Limit orders: `limitPriceE9 / 1e9 × quantityE9 / 1e9` (from intent params, no API call)
  - Market orders: `perpMarketPrice × quantityE9 / 1e9` (from context)
- **Context needed:** `PolicyContext.perpMarketPrice` for market orders (resolved at CLI boundary from exchange ticker)
- **Price unavailable:** If `perpMarketPrice` is undefined for a market order, the check **passes with a warning** (same pattern as `SpendingLimitCheck` when oracle price is unavailable — permissive on price failure, logged for audit). Returns `{ status: 'pass', metadata: { skipped: true, reason: 'perp_market_price_unavailable' } }`

### 4. PerpVolumeCheck (`perp_24h_volume`)

- **Applies to:** `perp:place_order`
- **Passes when:** `config.perp.max_24h_volume` is absent, or projected 24h volume ≤ limit
- **Rejects when:** Rolling 24h volume + this order's notional > `max_24h_volume`
- **Volume source:** `activityLog.getRolling24hPerpVolume(chainId)` — counts `perp:place_order` approved rows
- **Note on counting approach:** Uses `perp:place_order` (intent) not `perp:filled` (actual fills). This is conservative — orders rejected by the exchange after pipeline approval still count. This avoids depending on `fence perp sync` being called. The trade-off must be documented in code comments and user-facing config docs.

### 5. PerpWithdrawLimitCheck (`perp_withdraw_limit`)

- **Applies to:** `perp:withdraw`
- **Passes when:** `config.perp.max_24h_withdraw` is absent, or projected 24h withdrawals ≤ limit
- **Rejects when:** Rolling 24h withdrawals + this withdrawal > `max_24h_withdraw`
- **Volume source:** `activityLog.getRolling24hPerpWithdrawals(chainId)`

## PolicyContext Extensions

```typescript
export interface PolicyContext {
  readonly config: ChainConfig;
  readonly activityLog: ActivityLogReader;
  readonly tradeValueUsd?: number;
  // New:
  readonly perpMarketPrice?: number;          // Last price from exchange ticker (USD)
  readonly perpMarketMaxLeverage?: number;    // On-chain max leverage for this market
}
```

Resolved at the CLI boundary in `perp.ts` order command before calling the pipeline. Other perp commands (cancel, deposit, withdraw) don't need these fields — the checks that use them only apply to `perp:place_order`.

## Price Resolution

Perp market price comes from the exchange ticker, not the spot oracle:

```typescript
// Added to PerpProvider interface:
getTickerPrice(marketSymbol: string): Promise<number>;
```

Implementation calls Bluefin's `GET /exchange/ticker?symbol=SUI-PERP` and returns the last traded price. This is resolved once at the CLI boundary and passed through `PolicyContext.perpMarketPrice`.

## ActivityLog Extensions

Two new prepared statements added to BOTH `ActivityLog` class AND `ActivityLogReader` interface (the typed interface used by `PolicyContext`). The `InMemoryTradeWindow` (daemon mode) must also implement these methods.

```typescript
// Added to ActivityLogReader interface:
getRolling24hPerpVolume(chainId: ChainId): number;
getRolling24hPerpWithdrawals(chainId: ChainId): number;

// Implementation in ActivityLog class:

/** Rolling 24h approved perp order volume in USD. */
getRolling24hPerpVolume(chainId: ChainId): number
// SQL: SELECT COALESCE(SUM(value_usd), 0) FROM activities
//      WHERE chain_id = ? AND action = 'perp:place_order'
//      AND policy_decision = 'approved'
//      AND created_at > datetime('now', '-24 hours')

/** Rolling 24h approved perp withdrawal volume in USD. */
getRolling24hPerpWithdrawals(chainId: ChainId): number
// SQL: SELECT COALESCE(SUM(value_usd), 0) FROM activities
//      WHERE chain_id = ? AND action = 'perp:withdraw'
//      AND policy_decision = 'approved'
//      AND created_at > datetime('now', '-24 hours')
```

## Withdraw USD Value Resolution

`PerpWithdrawIntent` uses USDC which is 1:1 with USD. The CLI withdraw command resolves `tradeValueUsd` from the withdraw amount before calling the pipeline:

```typescript
// In registerWithdrawAction, before executePipeline:
const tradeValueUsd = parseFloat(amountStr); // USDC amount = USD value
const policyCtx: PolicyContext = { config: chainConfig, activityLog, tradeValueUsd };
```

The `PerpWithdrawLimitCheck` reads `ctx.tradeValueUsd` for the current withdrawal's value. If unavailable, the check passes (permissive, same pattern as other USD-dependent checks).

## File Changes

### New files:
- `src/policy/checks/perp-market-allowlist.ts`
- `src/policy/checks/perp-leverage-cap.ts`
- `src/policy/checks/perp-order-size.ts`
- `src/policy/checks/perp-volume.ts`
- `src/policy/checks/perp-withdraw-limit.ts`

### Modified files:
- `src/types/config.ts` — add `PerpConfig`, `SecurityConfig` perp ceilings, add to `ChainConfig`
- `src/policy/context.ts` — add `perpMarketPrice`, `perpMarketMaxLeverage`
- `src/db/activity-log.ts` — add `getRolling24hPerpVolume`, `getRolling24hPerpWithdrawals` to class + `ActivityLogReader` interface
- `src/cli/commands/perp.ts` — resolve price/leverage/tradeValueUsd context before pipeline calls
- `src/cli/bootstrap.ts` — register 5 new policy checks
- `src/config/schema.ts` — default `PerpConfig`, validation rules, ceiling enforcement
- `src/core/perp-provider.ts` — add `getTickerPrice` to interface
- `src/chain/sui/bluefin-pro/provider.ts` — implement `getTickerPrice`
- `src/daemon/trade-window.ts` — implement `getRolling24hPerpVolume`, `getRolling24hPerpWithdrawals` on `InMemoryTradeWindow`

### Unchanged:
- `src/core/transaction-pipeline.ts` — already runs policy for off-chain
- `src/policy/check.ts` — interface unchanged
- `src/policy/registry.ts` — registry unchanged

## Registration Order

```typescript
// In bootstrap.ts buildPolicyRegistry():
registry.register(new TokenAllowlistCheck(tryResolveTokenAddress));      // existing
registry.register(new SpendingLimitCheck());                              // existing
registry.register(new PerpMarketAllowlistCheck());                        // new
registry.register(new PerpLeverageCapCheck());                            // new
registry.register(new PerpOrderSizeCheck());                              // new
registry.register(new PerpVolumeCheck());                                 // new
registry.register(new PerpWithdrawLimitCheck());                          // new
```

Short-circuits on first rejection. Non-perp actions pass through all perp checks immediately.

## CLI UX

Config via `fence config set`:

```bash
# Enable perp trading for specific markets
fence config set chain.sui.perp.allowlist_markets '["SUI-PERP", "BTC-PERP"]'

# Set limits
fence config set chain.sui.perp.max_leverage 10
fence config set chain.sui.perp.max_single_order 500
fence config set chain.sui.perp.max_24h_volume 5000
fence config set chain.sui.perp.max_24h_withdraw 1000
```

Rejection output follows existing pattern:

```json
{
  "status": "rejected",
  "action": "perp:place_order",
  "rejectionCheck": "perp_market_allowlist",
  "rejectionReason": "Market \"DOGE-PERP\" is not in the perp allowlist"
}
```
