# E2E Test Report: WebSocket Order Confirmation

**Date:** 2026-03-26
**Commit:** `c584275` + uncommitted WS subscribe fix + IOC/FOK fix
**Fix:** WS now subscribes to `AccountOrderUpdate` + `AccountCommandFailureUpdate` after connecting; IOC/FOK `INSUFFICIENT_LIQUIDITY` treated as acknowledged

## Summary

| Total | Passed | Failed |
|-------|--------|--------|
| 13    | 13     | 0      |

**Verdict: ALL PASS.** BUG-1 (silent order rejection) is **FIXED** with specific exchange rejection reasons delivered via WS. IOC/FOK regression (BUG-WS-5) also **FIXED** -- builder now treats `INSUFFICIENT_LIQUIDITY` as acknowledged for IOC/FOK orders.

## BUG-1 Fix Verification

**Was BUG-1 (silent rejection) fixed? YES.**

Evidence from Tests 5-7 (and Test 12):
- Test 5 (insufficient margin): `status: "error"`, exit 1, reason: **`INSUFFICIENT_MARGIN`** (was: "order not found after placement")
- Test 6 (min notional): `status: "error"`, exit 1, reason: **`QUANTITY_OUT_OF_BOUND`** (was: "order not found after placement")
- Test 7 (reduce-only, no position): `status: "error"`, exit 1, reason: **`REDUCE_ONLY_WOULD_OPEN`** (was: "order not found after placement")
- Test 12 (second order, insufficient margin): `status: "error"`, exit 1, reason: **`INSUFFICIENT_MARGIN`**

The WS `AccountCommandFailureUpdate` subscription now delivers the exchange's actual rejection reason, a major improvement over the generic HTTP poll fallback message.

## WS vs HTTP Poll Analysis

**WS confirmation is now the primary path.** Response times dropped from 13-14s (HTTP poll after WS timeout) to 2.5-3.5s (direct WS event delivery). The HTTP poll (lines 96-97 in place-order.ts) now serves as a secondary verification for confirmed orders, not the primary detection mechanism.

| Metric | Before (HTTP poll) | After (WS subscribe fix) |
|--------|-------------------|--------------------------|
| Success confirmation | 13-14s | 3-3.5s |
| Rejection detection | 13-14s | 2.5-3s |
| Error messages | Generic "order not found" | Specific exchange reason |
| IOC/FOK handling | Correct (acknowledged) | Correct (acknowledged) |

## Test Results

| # | Test | Expected | Actual | Status | Response Time |
|---|------|----------|--------|--------|---------------|
| 1 | SHORT SUI-PERP at $5, 5x | success + order visible | success, `orderHash: "0e8115..."` | PASS | 3.5s |
| 2 | Cancel Test 1 order | cancelled | success, `cancelledCount: 1` | PASS | 2.1s |
| 3 | LONG SUI-PERP at $0.5, 5x | success + order visible | success, `orderHash: "640df7..."` | PASS | 3.3s |
| 4 | Cancel Test 3 order | cancelled | success, `cancelledCount: 1` | PASS | 2.4s |
| 5 | SHORT SUI-PERP at $5, lev=2 (insufficient margin) | error with rejection reason | error: `INSUFFICIENT_MARGIN`, exit 1 | PASS | 2.6s |
| 6 | SHORT BTC-PERP 0.0001 at $200k, lev=10 (min notional) | error with rejection reason | error: `QUANTITY_OUT_OF_BOUND`, exit 1 | PASS | 2.6s |
| 7 | SHORT SUI-PERP at $5, 5x, reduce-only (no position) | error with rejection reason | error: `REDUCE_ONLY_WOULD_OPEN`, exit 1 | PASS | ~3s |
| 8 | SHORT SUI-PERP at $5, TIF=IOC, 5x | success/acknowledged | success, `orderHash: "c11a31..."`, exit 0 | PASS | ~3s |
| 9 | SHORT SUI-PERP at $5, TIF=FOK, 5x | success/acknowledged | success, `orderHash: "049ae4..."`, exit 0 | PASS | ~3s |
| 10 | Timeout handling | document behavior | WS delivers events in 2.5-3.5s; timeout path no longer exercised | PASS | N/A |
| 11 | SHORT SUI-PERP at $5, 5x (1st of 2) | success + order visible | success, `orderHash: "6b971a..."` | PASS | ~3s |
| 12 | SHORT SUI-PERP at $6, 5x (2nd, insufficient margin) | error | error: `INSUFFICIENT_MARGIN`, exit 1 | PASS | ~3s |
| 13 | Cancel remaining orders | cancelled | success, `cancelledCount: 1` | PASS | ~2s |

## Detailed Test Output

### Test 1: SHORT SUI-PERP at $5, 5x (PASS)

**Command:** `bun dev perp order SUI-PERP SHORT 1 -t limit -p 5 -l 5`
**Time:** 3.5s | **Exit code:** 0

```json
{
  "status": "success",
  "action": "perp:place_order",
  "chainId": "sui:mainnet",
  "address": "0x350b36d7426958e9a25814cfcde6761629be59b09e50834a498110620a9b81bc",
  "protocol": "bluefin_pro",
  "payload": {
    "marketSymbol": "SUI-PERP",
    "side": "SHORT",
    "orderType": "LIMIT",
    "quantityE9": "1000000000",
    "leverageE9": "5000000000",
    "priceE9": "5000000000",
    "orderHash": "0e811599232674cb148d8705ab161abb2fa3956b0487fb126e925da4546234fb"
  }
}
```

Order verified in `perp orders` -- orderHash matches.

### Test 2: Cancel (PASS)

**Command:** `bun dev perp cancel SUI-PERP`
**Time:** 2.1s | **Exit code:** 0

```json
{
  "status": "success",
  "action": "perp:cancel_order",
  "chainId": "sui:mainnet",
  "address": "0x350b36d7426958e9a25814cfcde6761629be59b09e50834a498110620a9b81bc",
  "protocol": "bluefin_pro",
  "payload": {
    "marketSymbol": "SUI-PERP",
    "cancelledCount": 1
  }
}
```

### Test 3: LONG SUI-PERP at $0.5, 5x (PASS)

**Command:** `bun dev perp order SUI-PERP LONG 1 -t limit -p 0.5 -l 5`
**Time:** 3.3s | **Exit code:** 0

```json
{
  "status": "success",
  "action": "perp:place_order",
  "chainId": "sui:mainnet",
  "address": "0x350b36d7426958e9a25814cfcde6761629be59b09e50834a498110620a9b81bc",
  "protocol": "bluefin_pro",
  "payload": {
    "marketSymbol": "SUI-PERP",
    "side": "LONG",
    "orderType": "LIMIT",
    "quantityE9": "1000000000",
    "leverageE9": "5000000000",
    "priceE9": "500000000",
    "orderHash": "640df7303c9dca7746f35482a5f69ea0abb0a8c7e8395867d42438ffde3c983d"
  }
}
```

Order verified in `perp orders` -- orderHash matches.

### Test 4: Cancel (PASS)

**Command:** `bun dev perp cancel SUI-PERP`
**Time:** 2.4s | **Exit code:** 0

```json
{
  "status": "success",
  "action": "perp:cancel_order",
  "chainId": "sui:mainnet",
  "address": "0x350b36d7426958e9a25814cfcde6761629be59b09e50834a498110620a9b81bc",
  "protocol": "bluefin_pro",
  "payload": {
    "marketSymbol": "SUI-PERP",
    "cancelledCount": 1
  }
}
```

### Test 5: Insufficient Margin (PASS -- BUG-1 FIX VERIFIED)

**Command:** `bun dev perp order SUI-PERP SHORT 1 -t limit -p 5 -l 2`
**Time:** 2.6s | **Exit code:** 1

```json
{
  "status": "error",
  "action": "perp:place_order",
  "chainId": "sui:mainnet",
  "address": "0x350b36d7426958e9a25814cfcde6761629be59b09e50834a498110620a9b81bc",
  "protocol": "bluefin_pro",
  "error": "Order rejected by exchange: INSUFFICIENT_MARGIN"
}
```

### Test 6: Min Notional / Quantity Violation (PASS -- BUG-1 FIX VERIFIED)

**Command:** `bun dev perp order BTC-PERP SHORT 0.0001 -t limit -p 200000 -l 10`
**Time:** 2.6s | **Exit code:** 1

```json
{
  "status": "error",
  "action": "perp:place_order",
  "chainId": "sui:mainnet",
  "address": "0x350b36d7426958e9a25814cfcde6761629be59b09e50834a498110620a9b81bc",
  "protocol": "bluefin_pro",
  "error": "Order rejected by exchange: QUANTITY_OUT_OF_BOUND"
}
```

### Test 7: Reduce-Only With No Position (PASS -- BUG-1 FIX VERIFIED)

**Command:** `npx tsx src/cli/index.ts perp order SUI-PERP SHORT 1 -t limit -p 5 -l 5 -r`
**Time:** ~3s | **Exit code:** 1

```json
{
  "status": "error",
  "action": "perp:place_order",
  "chainId": "sui:mainnet",
  "address": "0x350b36d7426958e9a25814cfcde6761629be59b09e50834a498110620a9b81bc",
  "protocol": "bluefin_pro",
  "error": "Order rejected by exchange: REDUCE_ONLY_WOULD_OPEN"
}
```

### Test 8: IOC Order (PASS -- BUG-WS-5 FIXED)

**Command:** `npx tsx src/cli/index.ts perp order SUI-PERP SHORT 1 -t limit -p 5 -l 5 --tif IOC`
**Time:** ~3s | **Exit code:** 0

```json
{
  "status": "success",
  "action": "perp:place_order",
  "chainId": "sui:mainnet",
  "address": "0x350b36d7426958e9a25814cfcde6761629be59b09e50834a498110620a9b81bc",
  "protocol": "bluefin_pro",
  "payload": {
    "marketSymbol": "SUI-PERP",
    "side": "SHORT",
    "orderType": "LIMIT",
    "quantityE9": "1000000000",
    "leverageE9": "5000000000",
    "priceE9": "5000000000",
    "orderHash": "c11a31e5a605610d8e01f4f9e630e8ba4dfed322e504d73b19628ee046129653"
  }
}
```

IOC order accepted by exchange, no counterparty match. WS received `AccountOrderUpdate` (OPEN) before the `AccountCommandFailureUpdate`, so the confirmation path was used. HTTP poll found no open order, IOC special path returned success. Exit code 0 -- correct.

### Test 9: FOK Order (PASS -- BUG-WS-5 FIXED)

**Command:** `npx tsx src/cli/index.ts perp order SUI-PERP SHORT 1 -t limit -p 5 -l 5 --tif FOK`
**Time:** ~3s | **Exit code:** 0

```json
{
  "status": "success",
  "action": "perp:place_order",
  "chainId": "sui:mainnet",
  "address": "0x350b36d7426958e9a25814cfcde6761629be59b09e50834a498110620a9b81bc",
  "protocol": "bluefin_pro",
  "payload": {
    "marketSymbol": "SUI-PERP",
    "side": "SHORT",
    "orderType": "LIMIT",
    "quantityE9": "1000000000",
    "leverageE9": "5000000000",
    "priceE9": "5000000000",
    "orderHash": "049ae4a4f1192571d6f8ab4bb126ab3fbc2bad5ba310460d618cc7e170ed030b"
  }
}
```

Same behavior as IOC -- correct. Exit code 0.

### Test 10: Timeout Handling (Analysis)

With the WS subscribe fix, the WS now delivers events in 2.5-3.5s. The 20s timeout (line 64 in place-order.ts) is no longer exercised for any test scenario. The WS is the primary confirmation/rejection path. The HTTP poll still runs as a secondary verification for confirmed orders.

### Test 11: First of Two Orders (PASS)

**Command:** `npx tsx src/cli/index.ts perp order SUI-PERP SHORT 1 -t limit -p 5 -l 5`
**Time:** ~3s | **Exit code:** 0

```json
{
  "status": "success",
  "action": "perp:place_order",
  "chainId": "sui:mainnet",
  "address": "0x350b36d7426958e9a25814cfcde6761629be59b09e50834a498110620a9b81bc",
  "protocol": "bluefin_pro",
  "payload": {
    "marketSymbol": "SUI-PERP",
    "side": "SHORT",
    "orderType": "LIMIT",
    "quantityE9": "1000000000",
    "leverageE9": "5000000000",
    "priceE9": "5000000000",
    "orderHash": "6b971ac396e9bff2a2b449729acf6cdc36f31eb4ac603fcaeff0dea90f8101ad"
  }
}
```

### Test 12: Second Order, Insufficient Margin (PASS -- BUG-1 FIX VERIFIED)

**Command:** `npx tsx src/cli/index.ts perp order SUI-PERP SHORT 1 -t limit -p 6 -l 5`
**Time:** ~3s | **Exit code:** 1

```json
{
  "status": "error",
  "action": "perp:place_order",
  "chainId": "sui:mainnet",
  "address": "0x350b36d7426958e9a25814cfcde6761629be59b09e50834a498110620a9b81bc",
  "protocol": "bluefin_pro",
  "error": "Order rejected by exchange: INSUFFICIENT_MARGIN"
}
```

### Test 13: Cancel Remaining (PASS)

**Command:** `npx tsx src/cli/index.ts perp cancel SUI-PERP`
**Exit code:** 0

```json
{
  "status": "success",
  "action": "perp:cancel_order",
  "chainId": "sui:mainnet",
  "address": "0x350b36d7426958e9a25814cfcde6761629be59b09e50834a498110620a9b81bc",
  "protocol": "bluefin_pro",
  "payload": {
    "marketSymbol": "SUI-PERP",
    "cancelledCount": 1
  }
}
```

## Verification Checklist Summary

| Check | Tests 1,3,11 (success) | Tests 5,6,7,12 (rejection) | Tests 8,9 (IOC/FOK) | Tests 2,4,13 (cancel) |
|-------|------------------------|---------------------------|---------------------|-----------------------|
| CLI output captured | Yes | Yes | Yes | Yes |
| Order verified / not found | Visible with orderHash | No order (correct) | No order (correct) | Cancelled (count=1) |
| Error includes rejection reason | N/A | Yes (specific) | N/A | N/A |
| Exit code correct | 0 | 1 | 0 | 0 |
| Structured JSON on stdout | Yes | Yes | Yes | Yes |
| Clean stderr | Yes | Yes | Yes | Yes |
| Process exits cleanly | Yes | Yes | Yes | Yes |
| orderHash in payload | Yes | N/A | Yes | N/A |

## Fix History

| Commit | Approach | Result |
|--------|----------|--------|
| `aa17d91` | WS listener before order placement | FAILED -- WS connected as fire-and-forget, missed fast rejections |
| `03e8076` | Grace period (2s) after OPEN before confirming | FAILED -- exchange cancels >2s after OPEN |
| `5982738` | HTTP poll fallback in client `waitForOrderEvent` | PARTIAL -- BUG-1 fixed but 13-14s response time, generic error messages |
| `c584275` | HTTP verification moved to builder, IOC/FOK edge case | PASS -- but WS still not subscribing to events |
| `c584275` + WS subscribe fix | Subscribe to AccountOrderUpdate + AccountCommandFailureUpdate | PASS -- 3s response, specific errors, but IOC/FOK regressed (BUG-WS-5) |
| `c584275` + WS subscribe + IOC/FOK fix | Builder treats INSUFFICIENT_LIQUIDITY as acknowledged for IOC/FOK | **ALL PASS** -- 3s response, specific errors, IOC/FOK correct |

## Previously Reported Issues -- All Resolved

| Issue | Status |
|-------|--------|
| BUG-1: Silent rejection | **FIXED** -- WS delivers specific rejection reasons |
| BUG-WS-2: Missing orderHash in success payload | FIXED -- consistently present |
| BUG-WS-3: cancelledCount always 0 | FIXED -- correctly reports count |
| BUG-WS-4: IOC SDK stream error | FIXED -- no longer occurs |
| BUG-WS-5: IOC/FOK reported as error | **FIXED** -- builder treats INSUFFICIENT_LIQUIDITY as acknowledged for IOC/FOK |
