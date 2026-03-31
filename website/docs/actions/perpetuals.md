---
sidebar_position: 3
title: Perpetual Futures
description: Trade perpetual futures on Bluefin Pro via OnlyFence — place orders, close positions, manage margin, and query funding rates with full safety guardrails.
keywords: [perpetual futures, perp trading, Bluefin Pro, leverage trading, margin trading, Sui perps, DeFi derivatives, funding rate]
---

# Perpetual Futures

Trade perpetual futures on Bluefin Pro through OnlyFence. Place market and limit orders, manage positions, deposit and withdraw margin — all with safety guardrails that enforce market allowlists, leverage caps, order size limits, and volume controls.

## Quick Start

```bash
# Enable perp trading in config
fence config set chain.sui.perp.allowlist_markets '["SUI-PERP", "BTC-PERP", "ETH-PERP"]'
fence config set chain.sui.perp.max_leverage 10

# Deposit margin
fence perp deposit 100

# Place a limit order
fence perp order SUI-PERP long 10 --type limit --price 3.50 --leverage 5

# Check positions
fence perp positions

# Close a position
fence perp close SUI-PERP
```

## Available Markets

```bash
fence perp markets
```

Returns all tradeable markets with their configuration: symbol, leverage bounds, order size limits, tick size, and fee rates.

## Placing Orders

```bash
fence perp order <market> <side> <qty> [options]
```

| Argument | Description |
|----------|-------------|
| `market` | Market symbol (e.g., `SUI-PERP`, `BTC-PERP`) |
| `side` | `long` or `short` |
| `qty` | Quantity in the base asset (e.g., `10` = 10 SUI) |

| Option | Default | Description |
|--------|---------|-------------|
| `--type` | `market` | `market` or `limit` |
| `--price` | — | Limit price in USD (required for limit orders) |
| `--leverage` | auto | Auto-resolved from existing position or market default |
| `--tif` | `GTT` | Time in force: `GTT`, `IOC`, or `FOK` (limit only) |
| `--reduce-only` | `false` | Only reduce an existing position |

### Examples

```bash
# Market order — fills immediately
fence perp order SUI-PERP long 10 --type market

# Limit order with leverage
fence perp order BTC-PERP short 0.01 --type limit --price 100000 --leverage 10

# Reduce-only to partially close
fence perp order SUI-PERP short 5 --type market --reduce-only
```

### Order Confirmation

Orders are confirmed via WebSocket. The CLI waits for the exchange to accept or reject the order before returning:

- **`success`** — order confirmed on the exchange
- **`acknowledged`** — order submitted but WebSocket confirmation timed out. Verify with `fence perp orders`
- **`rejected`** — blocked by policy (exit code 3) with the rejection reason
- **`error`** — exchange rejected with a reason (e.g., `INSUFFICIENT_MARGIN`)

### Leverage

When `--leverage` is omitted:
1. If you have an existing position on that market, the position's leverage is used
2. Otherwise, the market's default leverage is used

This prevents `INVALID_LEVERAGE` errors in cross-margin mode, where all orders on a market must share the same leverage.

## Closing Positions

```bash
fence perp close <market> [--size <qty>]
```

Auto-detects your position side and places a reduce-only market order in the opposite direction. Omit `--size` to close the full position.

```bash
# Close entire SUI-PERP position
fence perp close SUI-PERP

# Partial close
fence perp close SUI-PERP --size 5
```

## Cancelling Orders

```bash
# Cancel all open orders on a market
fence perp cancel SUI-PERP

# Cancel a specific order by hash
fence perp cancel SUI-PERP --order <hash>

# Cancel multiple specific orders
fence perp cancel SUI-PERP -o <hash1> -o <hash2>
```

## Margin Management

### Deposit

Deposit USDC to the Bluefin margin bank:

```bash
fence perp deposit <amount>
fence perp deposit 100
```

### Withdraw

Withdraw USDC from the margin bank:

```bash
fence perp withdraw <amount>
fence perp withdraw 50
```

## Query Commands

All query commands return JSON on stdout and hit the Bluefin API directly (live data, not cached).

### Positions

```bash
fence perp positions
```

Returns open positions with: `symbol`, `side`, `sizeE9`, `avgEntryPriceE9`, `liquidationPriceE9`, `unrealizedPnlE9`, `leverageE9`.

### Open Orders

```bash
fence perp orders
fence perp orders --market SUI-PERP
```

### Order Status

```bash
fence perp order-status <orderHash>
```

Checks both open and standby orders.

### Account Overview

```bash
fence perp account
```

Returns full account details: margin balance, free margin, account value, unrealized PnL, and all positions.

### Funding Rates

```bash
# Exchange-level funding rate history
fence perp funding-rate SUI-PERP
fence perp funding-rate BTC-PERP --limit 5

# Your personal funding payments
fence perp funding-history
fence perp funding-history --limit 10
```

### Sync Fills

```bash
fence perp sync
```

Syncs filled trades from the Bluefin API to your local activity database. This enables querying perp fills alongside swaps and lending in `fence query activities`.

## Safety Guardrails

Perp trading is protected by 5 policy checks. All checks run before every order is submitted to the exchange.

### Market Allowlist (Default-Deny)

Unlike swaps where all tokens are allowed by default, **perp markets are blocked until explicitly enabled**. Without a `[chain.sui.perp]` config section, all perp orders are rejected.

```toml
[chain.sui.perp]
allowlist_markets = ["SUI-PERP", "BTC-PERP", "ETH-PERP"]
```

- **Place orders:** market must be in the list
- **Cancel orders:** always allowed (you must be able to unwind)
- **Withdraw:** always allowed (you must be able to exit)
- **Deposit:** allowed if any market is enabled (perp is active)

### Leverage Cap

```toml
[chain.sui.perp]
max_leverage = 10
```

The effective cap is the **lower** of your config value and the on-chain market maximum. If the exchange allows 50x but your config says 10x, orders above 10x are rejected.

### Order Size Limit

```toml
[chain.sui.perp]
max_single_order = 500
```

Maximum notional value per order in USD. For limit orders, notional = `price × quantity`. For market orders, notional uses the current exchange ticker price.

### Daily Volume Limit

```toml
[chain.sui.perp]
max_24h_volume = 5000
```

Rolling 24-hour perp trading volume cap in USD. Separate from the spot swap volume limit — the two don't interact.

:::note Volume Counting
Volume is counted from order placement (intent), not from actual fills. This means orders that pass the CLI policy check but are later rejected by the exchange still count toward your volume. This is conservative by design — it prevents limit exhaustion via failed orders without requiring fill sync.
:::

### Withdrawal Limit

```toml
[chain.sui.perp]
max_24h_withdraw = 1000
```

Rolling 24-hour margin withdrawal cap in USD. Prevents an agent from draining the margin account.

### Full Config Example

```toml
[chain.sui.perp]
allowlist_markets = ["SUI-PERP", "BTC-PERP", "ETH-PERP"]
max_leverage = 10
max_single_order = 500
max_24h_volume = 5000
max_24h_withdraw = 1000
```

### Rejection Response

When a policy check blocks an order:

```json
{
  "status": "rejected",
  "action": "perp:place_order",
  "rejectionCheck": "perp_leverage_cap",
  "rejectionReason": "Leverage 20x exceeds effective cap of 10x (config: 10x, on-chain max: 50x)"
}
```

## Supported Protocols

| Protocol | Chain | Status |
|----------|-------|--------|
| Bluefin Pro | Sui | Live |

## Numeric Format

All values from the Bluefin API use **e9 format** — divide by 10^9 for human-readable values:

| Field | e9 Value | Human Value |
|-------|----------|-------------|
| `sizeE9: "10000000000"` | ÷ 10^9 | 10 units |
| `leverageE9: "20000000000"` | ÷ 10^9 | 20x |
| `priceE9: "3800000000"` | ÷ 10^9 | $3.80 |
| `takerFeeE9: "500000"` | ÷ 10^9 × 100 | 0.05% |

## Activity Tracking

Perp actions are logged in the activity database alongside swaps and lending:

- **`perp:place_order`** — recorded when the CLI submits an order (intent)
- **`perp:filled`** — recorded when `fence perp sync` imports fills from the exchange
- **`perp:deposit`** — on-chain USDC deposit to margin bank
- **`perp:withdraw`** — margin bank withdrawal

Query perp activity with:

```bash
fence query activities -f category=eq=perp --order-by created_at=desc -o json
```
