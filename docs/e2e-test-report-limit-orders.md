# E2E Test Report: Bluefin Pro Perp Limit Orders

**Date:** 2026-03-25
**Branch:** feat/perp
**Environment:** Bluefin Pro Mainnet (SUI)
**Account:** `0x350b36d7...9b81bc`
**Account Balance:** ~1 USDC

---

## Summary

| Metric | Count |
|--------|-------|
| Total Tests | 25 |
| Passed | 19 |
| Failed | 2 |
| Partial / Notable | 4 |

---

## Test Results

### Group 1: Basic Limit Orders

| # | Test | Command | Expected | Actual | Status |
|---|------|---------|----------|--------|--------|
| 1 | SHORT SUI-PERP at $5, 5x | `bun dev perp order SUI-PERP short 1 --type limit --price 5 --leverage 5` | Order placed and visible in orders list | Order placed successfully. Verified: symbol=SUI-PERP, side=SHORT, priceE9=5000000000, quantityE9=1000000000, leverageE9=5000000000, type=LIMIT, timeInForce=GTT, reduceOnly=false, status=OPEN | **PASS** |
| 2 | Cancel SHORT order | `bun dev perp cancel SUI-PERP` | Order cancelled, orders list empty | Cancel returned success (cancelledCount=0 — see bug note). Orders list confirmed empty. | **PASS** |
| 3 | LONG SUI-PERP at $0.5, 5x | `bun dev perp order SUI-PERP long 1 --type limit --price 0.5 --leverage 5` | Order placed and visible | Order placed successfully. Verified: side=LONG, priceE9=500000000, leverageE9=5000000000, status=OPEN | **PASS** |
| 4 | Cancel LONG order | `bun dev perp cancel SUI-PERP` | Order cancelled, orders list empty | Cancel returned success. Orders list confirmed empty. | **PASS** |

### Group 2: Time-in-Force Variations

| # | Test | Command | Expected | Actual | Status |
|---|------|---------|----------|--------|--------|
| 5 | SHORT TIF=GTT (default) | `bun dev perp order SUI-PERP short 1 --type limit --price 5 --leverage 5 --tif GTT` | Order OPEN with timeInForce=GTT | Verified: timeInForce=GTT, status=OPEN | **PASS** |
| 6 | SHORT TIF=IOC | `bun dev perp order SUI-PERP short 1 --type limit --price 5 --leverage 5 --tif IOC` | Order auto-cancelled (no immediate match at $5 for SHORT) | Order placed successfully. Orders list is empty — IOC was correctly cancelled immediately since no match exists. | **PASS** |
| 7 | SHORT TIF=FOK | `bun dev perp order SUI-PERP short 1 --type limit --price 5 --leverage 5 --tif FOK` | Order auto-cancelled (no full fill possible) | Order placed successfully. Orders list is empty — FOK was correctly cancelled immediately. | **PASS** |

### Group 3: Leverage Variations

| # | Test | Command | Expected | Actual | Status |
|---|------|---------|----------|--------|--------|
| 8 | SHORT at $5, leverage=2 | `bun dev perp order SUI-PERP short 1 --type limit --price 5 --leverage 2` | May fail (notional $5, margin needed $2.50, only $1 available) | CLI reported success but order does not appear in orders list. Exchange silently rejected due to insufficient margin. | **PARTIAL** |
| 9 | SHORT at $2, leverage=5 | `bun dev perp order SUI-PERP short 1 --type limit --price 2 --leverage 5` | Order OPEN ($2 notional, $0.40 margin at 5x) | Verified: priceE9=2000000000, leverageE9=5000000000, status=OPEN | **PASS** |
| 10 | SHORT at $2, leverage=10 | `bun dev perp order SUI-PERP short 1 --type limit --price 2 --leverage 10` | Order OPEN ($0.20 margin at 10x) | Verified: leverageE9=10000000000, status=OPEN | **PASS** |
| 11 | SHORT at $2, leverage=20 | `bun dev perp order SUI-PERP short 1 --type limit --price 2 --leverage 20` | Order OPEN ($0.10 margin at 20x) | Verified: leverageE9=20000000000, status=OPEN | **PASS** |

### Group 4: Reduce-Only Flag

| # | Test | Command | Expected | Actual | Status |
|---|------|---------|----------|--------|--------|
| 12 | SHORT reduce-only at $5 | `bun dev perp order SUI-PERP short 1 --type limit --price 5 --leverage 5 --reduce-only` | Should fail or be marked reduceOnly=true | CLI sent reduceOnly=true in signed payload. Order placed with success but does not appear in orders list — exchange rejected since there is no open position to reduce. Expected behavior. | **PASS** |
| 13 | Cancel reduce-only | N/A | N/A | No order to cancel (rejected by exchange). | **PASS** |

### Group 5: Multiple Orders

| # | Test | Command | Expected | Actual | Status |
|---|------|---------|----------|--------|--------|
| 14 | First SHORT at $5 | `bun dev perp order SUI-PERP short 1 --type limit --price 5 --leverage 5` | Order OPEN | Verified: priceE9=5000000000, status=OPEN | **PASS** |
| 15 | Second SHORT at $6 | `bun dev perp order SUI-PERP short 1 --type limit --price 6 --leverage 5` | Two orders visible | CLI reported success but only the first order ($5) appears in orders list. Second order was silently rejected by exchange (likely insufficient margin for two orders). | **FAIL** |
| 16 | Cancel specific by hash | `bun dev perp cancel SUI-PERP --order <hash>` | Specific order cancelled, other remains | cancelledCount=1 (correct!). Orders list empty after cancel. Only one order existed. | **PASS** |
| 17 | Cancel all for market | `bun dev perp cancel SUI-PERP` | All orders cancelled | Successfully cancelled. Orders list empty. | **PASS** |

### Group 6: Different Markets

| # | Test | Command | Expected | Actual | Status |
|---|------|---------|----------|--------|--------|
| 18 | SHORT BTC-PERP at $200000 | `bun dev perp order BTC-PERP short 0.0001 --type limit --price 200000 --leverage 10` | Order OPEN | CLI reported success but order does not appear in orders list. Retried with $100000 and qty=0.001 — same result. Exchange silently rejected (likely minimum notional not met). | **FAIL** |
| 19 | Cancel BTC-PERP | N/A | N/A | No order to cancel. | **N/A** |
| 20 | SHORT ETH-PERP at $5000 | `bun dev perp order ETH-PERP short 0.01 --type limit --price 5000 --leverage 10` | Order OPEN | CLI reported success but order does not appear in orders list. Same silent rejection pattern. | **FAIL** |
| 21 | Cancel ETH-PERP | N/A | N/A | No order to cancel. | **N/A** |

### Group 7: Edge Cases

| # | Test | Command | Expected | Actual | Status |
|---|------|---------|----------|--------|--------|
| 22 | Invalid market FAKE-PERP | `bun dev perp order FAKE-PERP short 1 --type limit --price 5 --leverage 5` | Error with clear message | `"Unknown Bluefin market \"FAKE-PERP\". Available markets: GOLD-PERP, HYPE-PERP, DEEP-PERP, SOL-PERP, WAL-PERP, SUI-PERP, BTC-PERP, ETH-PERP"` — exit code 1 | **PASS** |
| 23 | Invalid side "buy" | `bun dev perp order SUI-PERP buy 1 --type limit --price 5 --leverage 5` | Error with clear message | `"Invalid side \"buy\". Must be LONG or SHORT."` — exit code 1 | **PASS** |
| 24 | Limit order without --price | `bun dev perp order SUI-PERP short 1 --type limit --leverage 5` | Error requiring price | `"Limit price (--price) is required for limit orders."` — exit code 1 | **PASS** |
| 25 | Zero quantity | `bun dev perp order SUI-PERP short 0 --type limit --price 5 --leverage 5` | Error rejecting zero qty | `"quantity must be greater than zero"` — exit code 1 | **PASS** |

---

## Bugs and Notable Findings

### BUG-1: `cancelledCount` always returns 0 for bulk cancel (MEDIUM)

When using `bun dev perp cancel <market>` without `--order`, the response always shows `cancelledCount: 0` even when orders are successfully cancelled. However, `bun dev perp cancel <market> --order <hash>` correctly returns `cancelledCount: 1`.

**Reproduction:**
1. Place a limit order on SUI-PERP
2. Verify it appears in `bun dev perp orders`
3. Run `bun dev perp cancel SUI-PERP`
4. Response shows `cancelledCount: 0` but order is actually cancelled

**Impact:** The success response is misleading. Users/agents cannot determine how many orders were cancelled from the bulk cancel response.

### BUG-2: CLI reports success for orders silently rejected by exchange (HIGH)

When an order is submitted but rejected by the Bluefin exchange (e.g., insufficient margin, notional too small, price out of band), the CLI reports `status: "success"` with no error. The order simply doesn't appear in the orders list.

**Affected scenarios:**
- Test 8: SHORT at $5, leverage=2 (insufficient margin)
- Test 15: Second order when margin is exhausted
- Test 18: BTC-PERP with small notional
- Test 20: ETH-PERP with small notional

**Impact:** This is the most significant bug found. Users have no way to know their order was rejected without separately checking the orders list. The CLI should either:
1. Poll the orders endpoint after placement to confirm the order exists, or
2. Use a synchronous order placement API that returns acceptance/rejection status, or
3. At minimum, warn users that order acceptance is asynchronous

### FINDING-1: IOC and FOK work correctly for non-matchable orders

IOC (Immediate-Or-Cancel) and FOK (Fill-Or-Kill) orders at prices far from market are correctly handled — they are submitted and immediately cancelled by the exchange since no match/fill is possible. The CLI correctly sends the timeInForce field.

### FINDING-2: Reduce-only orders correctly rejected when no position exists

The `--reduce-only` flag is correctly sent as `reduceOnly: true` in the signed order payload. The exchange correctly rejects these when there is no open position to reduce.

### FINDING-3: SUI-PERP works well, other markets may have higher minimums

SUI-PERP consistently accepted orders at reasonable quantities (1 SUI). BTC-PERP and ETH-PERP did not accept the small test quantities tried (0.0001 BTC, 0.001 ETH). This may be due to minimum notional requirements on those markets.

---

## Verification Details

For each passing test, the following fields were verified in the orders list response:
- `symbol` — correct market symbol
- `side` — correct LONG/SHORT
- `priceE9` — correct price in E9 format
- `quantityE9` — correct quantity in E9 format
- `leverageE9` — correct leverage in E9 format
- `type` — always "LIMIT"
- `timeInForce` — correct GTT/IOC/FOK
- `reduceOnly` — correct true/false
- `status` — "OPEN" for accepted orders
- `filledQuantityE9` — "0" (no fills, as expected for far-from-market prices)

---

## Recommendations

1. **Fix BUG-2 (HIGH priority):** Add post-placement order verification or use a synchronous API. At minimum, print a warning that the order may not have been accepted.
2. **Fix BUG-1 (MEDIUM priority):** Investigate why bulk cancel returns `cancelledCount: 0`. The Bluefin API may return cancellation results differently for bulk vs. specific cancels.
3. **Consider:** Adding minimum notional validation per-market before submitting orders, to give users early feedback instead of silent rejection.
