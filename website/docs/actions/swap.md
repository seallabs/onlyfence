---
sidebar_position: 1
title: Swap
---

# Swap

Swap tokens across multiple DEXes with best-price routing, powered by the 7K Aggregator.

## Usage

```bash
fence swap <from> <to> <amount> [options]
```

## Examples

```bash
# Swap 10 SUI for USDC
fence swap SUI USDC 10

# Swap with JSON output (for agents)
fence swap SUI USDC 100 --output json

# Swap using raw coin type
fence swap SUI 0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC 50
```

## How It Works

1. **Policy check** — verifies both tokens are in your allowlist, trade is under spending limits
2. **Quote** — finds the best route across Cetus, DeepBook, Bluefin, FlowX, and Turbos
3. **Simulate** — dry-runs the transaction to verify it will succeed
4. **Execute** — signs and submits the transaction
5. **Log** — records the trade in your activity history

## Supported DEXes

All swaps route through the [7K Aggregator](https://7k.ag), which finds the best price across:

| DEX | Protocol |
|-----|----------|
| Cetus | AMM |
| DeepBook | Order book |
| Bluefin | Order book |
| FlowX | AMM |
| Turbos | AMM |

## Safety Checks

Every swap goes through the policy engine:

- **Token allowlist** — both `from` and `to` tokens must be in your approved list
- **Per-trade limit** — trade USD value must be under `max_single_trade`
- **Daily volume limit** — rolling 24h total must stay under `max_24h_volume`

If any check fails, the swap is blocked and a rejection reason is returned.

## Response

### Success

```json
{
  "status": "success",
  "chain": "sui",
  "txDigest": "8Hk4...mW2p",
  "fromToken": "SUI",
  "toToken": "USDC",
  "amountIn": "100",
  "amountOut": "98.12",
  "valueUsd": 98.0,
  "route": "SUI -> USDC via Cetus"
}
```

### Rejection

```json
{
  "status": "rejected",
  "check": "token_allowlist",
  "reason": "token_not_allowed",
  "detail": "SCAM is not in the token allowlist"
}
```
