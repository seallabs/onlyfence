# E2E Test Report: Perp Policy Guardrails

**Date:** 2026-03-30
**Branch:** feat/perp
**Account:** 0x350b36d7426958e9a25814cfcde6761629be59b09e50834a498110620a9b81bc
**Account State:** ~1 USDC margin at start, ~0.18 USDC at end (after withdrawals)
**Network:** Bluefin Pro mainnet (sui:mainnet)

## Summary

| Total | Passed | Failed | Skipped |
|-------|--------|--------|---------|
| 29    | 27     | 0      | 2       |

All 5 policy checks were tested and verified working. Two checks (`perp_24h_volume`, `perp_withdraw_limit`) initially failed due to `value_usd` not being persisted to the activity log (BUG-1, BUG-2 below). After the fix was applied, both were re-tested and passed.

## Test Results

### Phase 1: Default-Deny (no perp config)

| # | Test | Config State | Command | Expected | Actual | Status |
|---|------|-------------|---------|----------|--------|--------|
| 1 | Default-deny (no perp config) | No `[chain.sui.perp]` section | `perp order SUI-PERP short 1 --type limit --price 5 --leverage 5` | REJECTED `perp_market_allowlist` | REJECTED `perp_market_allowlist`: "Perp trading is not enabled. Add a [chain.sui.perp] section with allowlist_markets to config.toml." (exit 3) | PASS |
| 2 | Markets query works without config | No `[chain.sui.perp]` section | `perp markets` | SUCCESS | SUCCESS -- returned 8 markets (exit 0) | PASS |

### Phase 2: Market Allowlist

| # | Test | Config State | Command | Expected | Actual | Status |
|---|------|-------------|---------|----------|--------|--------|
| 3 | SUI-PERP in allowlist | `allowlist_markets=["SUI-PERP"]` | `perp order SUI-PERP short 1 --type limit --price 5 --leverage 5` | SUCCESS | SUCCESS -- orderHash `a457e4...` (exit 0) | PASS |
| 4 | Cancel order | same | `perp cancel SUI-PERP` | SUCCESS | SUCCESS -- cancelledCount: 1 (exit 0) | PASS |
| 5 | BTC-PERP not in allowlist | `allowlist_markets=["SUI-PERP"]` | `perp order BTC-PERP short 0.001 --type limit --price 200000 --leverage 5` | REJECTED `perp_market_allowlist` | REJECTED `perp_market_allowlist`: "Market \"BTC-PERP\" is not in the perp allowlist. Allowed: SUI-PERP" (exit 3) | PASS |
| 6 | Add BTC-PERP to allowlist | config set | `config set chain.sui.perp.allowlist_markets '["SUI-PERP","BTC-PERP"]'` | SUCCESS | Set successfully (exit 0) | PASS |
| 7 | BTC-PERP now allowed | `allowlist_markets=["SUI-PERP","BTC-PERP"]` | `perp order BTC-PERP short 0.001 --type limit --price 200000 --leverage 5` | SUCCESS (policy pass) | ERROR: "INSUFFICIENT_MARGIN" (exit 1) -- **Policy passed correctly**, exchange rejected due to insufficient margin for BTC notional ($200). | PASS (policy) |
| 8 | Cancel BTC-PERP | same | `perp cancel BTC-PERP` | SUCCESS | SUCCESS -- cancelledCount: 0 (no order placed, expected) | PASS |

### Phase 3: Leverage Cap

| # | Test | Config State | Command | Expected | Actual | Status |
|---|------|-------------|---------|----------|--------|--------|
| 9 | Leverage 5x within 5x cap | `max_leverage=5` | `perp order SUI-PERP short 1 --type limit --price 5 --leverage 5` | SUCCESS | SUCCESS -- orderHash `7372cf...` (exit 0) | PASS |
| 10 | Cancel | same | `perp cancel SUI-PERP` | SUCCESS | SUCCESS -- cancelledCount: 1 | PASS |
| 11 | Leverage 10x exceeds 5x cap | `max_leverage=5` | `perp order SUI-PERP short 1 --type limit --price 5 --leverage 10` | REJECTED `perp_leverage_cap` | REJECTED `perp_leverage_cap`: "Requested leverage 10x exceeds effective cap of 5x (config)" (exit 3) | PASS |
| 12 | Raise leverage cap | config set | `config set chain.sui.perp.max_leverage 20` | SUCCESS | Set successfully | PASS |
| 13 | Leverage 10x within 20x cap | `max_leverage=20` | `perp order SUI-PERP short 1 --type limit --price 5 --leverage 10` | SUCCESS | SUCCESS -- orderHash `f231ff...` (exit 0) | PASS |
| 14 | Cancel | same | `perp cancel SUI-PERP` | SUCCESS | SUCCESS -- cancelledCount: 1 | PASS |

### Phase 4: Order Size Limit

| # | Test | Config State | Command | Expected | Actual | Status |
|---|------|-------------|---------|----------|--------|--------|
| 15 | Notional $5 exceeds $3 limit | `max_single_order=3` | `perp order SUI-PERP short 1 --type limit --price 5 --leverage 5` | REJECTED `perp_order_size` | REJECTED `perp_order_size`: "Order notional $5.00 exceeds max single order limit of $3.00" (exit 3) | PASS |
| 16 | Raise order size limit | config set | `config set chain.sui.perp.max_single_order 10` | SUCCESS | Set successfully | PASS |
| 17 | Notional $5 within $10 limit | `max_single_order=10` | `perp order SUI-PERP short 1 --type limit --price 5 --leverage 5` | SUCCESS | SUCCESS -- orderHash `5d5bc4...` (exit 0) | PASS |
| 18 | Cancel | same | `perp cancel SUI-PERP` | SUCCESS | SUCCESS -- cancelledCount: 1 | PASS |

### Phase 5: 24h Volume Limit

Initial run (pre-fix): Tests 19-22 passed but were false passes because `value_usd` was NULL. Test 23 FAILED (not rejected). After `value_usd` fix, re-tested:

| # | Test | Config State | Command | Expected | Actual | Status |
|---|------|-------------|---------|----------|--------|--------|
| 19 | 1st order, volume ~$0.87 <= $2 | `max_24h_volume=2` | `perp order SUI-PERP short 1 --type limit --price 5 --leverage 20` | SUCCESS | SUCCESS (exit 0), value_usd=0.8705 recorded | PASS |
| 20 | Cancel | same | `perp cancel SUI-PERP` | SUCCESS | SUCCESS | PASS |
| 21 | 2nd order, volume ~$1.74 <= $2 | `max_24h_volume=2` | `perp order SUI-PERP short 1 --type limit --price 5 --leverage 20` | SUCCESS | SUCCESS (exit 0), value_usd=0.8706 recorded | PASS |
| 22 | Cancel | same | `perp cancel SUI-PERP` | SUCCESS | SUCCESS | PASS |
| 23 | 3rd order, volume ~$2.61 > $2 | `max_24h_volume=2` | `perp order SUI-PERP short 1 --type limit --price 5 --leverage 20` | REJECTED `perp_volume` | REJECTED `perp_volume`: "24h perp volume $1.74 + $0.87 = $2.61 exceeds limit of $2.00" (exit 3) | **PASS** |
| 24 | Raise volume limit | config set | `config set chain.sui.perp.max_24h_volume 500` | SUCCESS | Set successfully | PASS |

### Phase 6: Withdrawal Limit

Initial run (pre-fix): Test 25 passed, Test 26 FAILED (not rejected). After `value_usd` fix, re-tested:

| # | Test | Config State | Command | Expected | Actual | Status |
|---|------|-------------|---------|----------|--------|--------|
| 25 | Withdraw $0.15 within $0.2 limit | `max_24h_withdraw=0.2` | `perp withdraw 0.15` | SUCCESS | SUCCESS (exit 0), value_usd=0.15 recorded | PASS |
| 26 | Withdraw $0.10 (total $0.25 > $0.2) | `max_24h_withdraw=0.2` | `perp withdraw 0.1` | REJECTED `perp_withdraw_limit` | REJECTED `perp_withdraw_limit`: "24h perp withdrawals $0.15 + $0.10 = $0.25 exceeds limit of $0.20" (exit 3) | **PASS** |
| 27 | Reset withdrawal limit | config set | `config set chain.sui.perp.max_24h_withdraw 100` | SUCCESS | Set successfully | PASS |

### Phase 7: Cancel/Withdraw Always Pass Allowlist

| # | Test | Config State | Command | Expected | Actual | Status |
|---|------|-------------|---------|----------|--------|--------|
| 28 | Cancel bypasses allowlist | `allowlist_markets=["BTC-PERP"]` (SUI-PERP removed) | `perp cancel SUI-PERP` | SUCCESS | SUCCESS -- cancelledCount: 0 (exit 0) | PASS |
| 29 | Withdraw bypasses allowlist | `allowlist_markets=["BTC-PERP"]` (SUI-PERP removed) | `perp withdraw 0.1` | SUCCESS | SUCCESS (exit 0) | PASS |

## Bugs Found and Fixed

### BUG-1: `value_usd` not persisted for perp orders (FIXED)

**Affected checks:** `perp_24h_volume` (Test 23)

**Root cause:** `PerpPlaceOrderIntent` was constructed without `valueUsd`. The trade value was computed in `resolvePerpPolicyOptions()` and flowed into `PolicyContext.tradeValueUsd` for the in-flight policy check, but was never written back onto the intent. When `BluefinPlaceOrderBuilder.finish()` read `intent.valueUsd`, it was `undefined`, so `value_usd` was NULL in the activity log.

**Fix applied:** Set `valueUsd: policyOptions.tradeValueUsd` on the intent in `registerOrderAction` and `registerCloseAction`.

**Verification:** After fix, `value_usd=0.8705` correctly recorded in activities table. Volume rejection triggers at $2.61 > $2.00 limit.

### BUG-2: `value_usd` not persisted for perp withdrawals (FIXED)

**Affected checks:** `perp_withdraw_limit` (Test 26)

**Root cause:** Same pattern as BUG-1. Withdraw intent was constructed without `valueUsd`.

**Fix applied:** Set `valueUsd: tradeValueUsd` on the intent in `registerWithdrawAction`.

**Verification:** After fix, `value_usd=0.15` correctly recorded. Withdrawal rejection triggers at $0.25 > $0.20 limit.

## Observation: Volume uses ticker price, not limit price

The `perp_order_size` check uses the **limit price** for limit orders (e.g., $5.00 for `--price 5`), while `tradeValueUsd` (used for volume tracking and the activity log) uses the **exchange ticker price** (~$0.87 for SUI at test time). This means:
- Order size check: 1 SUI at limit $5 = $5.00 notional
- Volume tracking: 1 SUI at ticker $0.87 = $0.87 recorded

This is by design (see `resolvePerpPolicyOptions` line 87), but worth noting that the volume limit and order size limit use different price bases.

## Config Changes Made

```bash
# Phase 2: Market Allowlist
bun dev config set chain.sui.perp.allowlist_markets '["SUI-PERP"]'
bun dev config set chain.sui.perp.allowlist_markets '["SUI-PERP","BTC-PERP"]'

# Phase 3: Leverage Cap
bun dev config set chain.sui.perp.max_leverage 5
bun dev config set chain.sui.perp.max_leverage 20

# Phase 4: Order Size
bun dev config set chain.sui.perp.max_single_order 3
bun dev config set chain.sui.perp.max_single_order 10

# Phase 5: 24h Volume (re-test with fix)
bun dev config set chain.sui.perp.max_24h_volume 10   # initial
bun dev config set chain.sui.perp.max_24h_volume 2    # re-test (adjusted for ticker price)
bun dev config set chain.sui.perp.max_24h_volume 500  # cleanup

# Phase 6: Withdrawal Limit (re-test with fix)
bun dev config set chain.sui.perp.max_24h_withdraw 0.5   # initial
bun dev config set chain.sui.perp.max_24h_withdraw 0.2   # re-test
bun dev config set chain.sui.perp.max_24h_withdraw 100   # cleanup

# Phase 7: Allowlist Bypass
bun dev config set chain.sui.perp.allowlist_markets '["BTC-PERP"]'

# Final Cleanup
bun dev config set chain.sui.perp.allowlist_markets '["SUI-PERP","BTC-PERP"]'
bun dev config set chain.sui.perp.max_leverage 20
bun dev config set chain.sui.perp.max_single_order 200
bun dev config set chain.sui.perp.max_24h_volume 500
bun dev config set chain.sui.perp.max_24h_withdraw 100
```
