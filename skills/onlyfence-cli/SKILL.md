---
name: onlyfence-cli
description: >
  How to use the OnlyFence CLI (`fence`) to execute DeFi actions on-chain with safety guardrails.
  Use this skill whenever the user asks to swap tokens, check wallet balances, query token prices,
  manage wallets, configure trading limits or token allowlists, or perform any on-chain DeFi action
  through OnlyFence. Also use when the user mentions "fence", "OnlyFence", trading guardrails,
  DeFi safety rules, or wants an AI agent to interact with the Sui blockchain. If the user asks
  to "trade", "swap", "check balance", "check price", or "set spending limit" in the context of
  this project, this skill applies.
---

# OnlyFence CLI — Agent Usage Guide

OnlyFence is a local CLI tool (`fence`) that gives AI agents full DeFi capabilities on the Sui blockchain — with safety guardrails enforced on every action. You call `fence` commands via the shell, parse structured JSON output, and react to the results.

## First-Time Setup

Before any on-chain action, the user needs a wallet. Check if OnlyFence is set up:

```bash
fence config show 2>/dev/null
```

If this errors with "Configuration file not found" or "No primary wallet found", guide the user through setup:

```bash
fence setup
```

This is an **interactive wizard** — it prompts for wallet generation/import and password. Do not try to automate or pipe input to it. Tell the user to run it themselves and come back when done.

After setup, the user should unlock their wallet for the session:

```bash
fence unlock          # default 4h session
fence unlock --ttl 8h # longer session
```

Valid TTL values: `1h`, `2h`, `4h`, `8h`, `12h`, `24h`.

## Session Management

The wallet must be unlocked before signing transactions (swaps). Read-only commands (query, config show, wallet list, stats) work without unlocking.

```bash
fence unlock            # prompts for password, creates 4h session
fence unlock --ttl 12h  # custom duration
fence lock              # end session immediately
```

## Core Commands

### Swap Tokens

```bash
fence swap <fromToken> <toToken> <amount> [options]
```

| Argument | Description |
|----------|-------------|
| `fromToken` | Source token symbol (e.g., `SUI`) |
| `toToken` | Destination token symbol (e.g., `USDC`) |
| `amount` | Amount in human-readable format (e.g., `10`, `0.5`) |

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --slippage <percent>` | `0.5` | Slippage tolerance in percent |
| `-c, --chain <chain>` | `sui` | Target chain |
| `-o, --output <format>` | `json` | Output format (only `json` supported) |

**Always use `--output json`** (or rely on the default) to get machine-parseable results.

#### Success response

```json
{
  "status": "success",
  "chain": "sui:mainnet",
  "action": "swap",
  "txDigest": "8Hk4...mW2p",
  "fromToken": "0x2::sui::SUI",
  "toToken": "0xdba3...::usdc::USDC",
  "amountIn": "100000000000",
  "amountOut": "98120000",
  "valueUsd": 98.0,
  "gasCost": 0.0021,
  "route": "7K Aggregator"
}
```

#### Policy rejection response (exit code 3)

```json
{
  "status": "rejected",
  "chain": "sui:mainnet",
  "action": "swap",
  "check": "spending_limit",
  "reason": "exceeds_24h_volume",
  "detail": "24h volume $480 + $98 = $578 exceeds limit of $500",
  "metadata": { "limit": 500, "current": 480, "requested": 98 }
}
```

Possible `check` values: `token_allowlist`, `spending_limit`
Possible `reason` values:
- `token_not_allowed` — token not in the configured allowlist
- `exceeds_single_trade_limit` — single trade exceeds `max_single_trade`
- `exceeds_24h_volume` — rolling 24h total would exceed `max_24h_volume`

#### Simulated response (watch-only wallet, exit code 0)

```json
{
  "status": "simulated",
  "chain": "sui:mainnet",
  "action": "swap",
  "fromToken": "0x2::sui::SUI",
  "toToken": "0xdba3...::usdc::USDC",
  "amountIn": "100000000000",
  "expectedOutput": "98120000",
  "provider": "7K Aggregator",
  "priceImpact": 0.15,
  "gasEstimate": 2100
}
```

#### Error response (exit code 1)

```json
{
  "status": "error",
  "message": "Human-readable error description"
}
```

### Query Balance

```bash
fence query balance [-c <chain>] [-o <format>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-c, --chain <chain>` | `sui` | Target chain |
| `-o, --output <format>` | `table` | `json` or `table` |

**Use `-o json`** for machine-parseable output:

```json
{
  "address": "0x7a3f...e821",
  "balances": [
    { "token": "SUI", "amount": "1000000000", "decimals": 9 },
    { "token": "USDC", "amount": "500000000", "decimals": 6 }
  ]
}
```

The `amount` field is in the smallest unit. To get human-readable values, divide by `10^decimals` (e.g., `1000000000` SUI with 9 decimals = `1.0` SUI).

### Query Price

```bash
fence query price <tokens...> [-o <format>]
```

Pass one or more token symbols separated by spaces:

```bash
fence query price SUI USDC DEEP -o json
```

```json
[
  { "token": "SUI", "priceUsd": 0.98 },
  { "token": "USDC", "priceUsd": 1.0 },
  { "token": "UNKNOWN", "priceUsd": null, "error": "Token not found" }
]
```

### Wallet Management

```bash
fence wallet list [-o json]          # list all wallets
fence wallet watch <address> [-c sui] [-a <alias>]  # add watch-only wallet
fence wallet switch <alias>          # set primary wallet
fence wallet rename <old> <new>      # rename a wallet
```

Watch-only wallets can simulate swaps but cannot sign real transactions.

### Configuration & Safety Rules

```bash
fence config show [key]              # show full config or a specific key
fence config set <key> <value>       # update a config value
fence config init [-f]               # create default config (--force to overwrite)
```

Keys use dot-notation. The important safety settings:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `chain.sui.allowlist.tokens` | string[] | `["SUI","USDC","USDT","DEEP","BLUE","WAL"]` | Only these tokens can be traded |
| `chain.sui.limits.max_single_trade` | number | `200` | Max USD value per trade |
| `chain.sui.limits.max_24h_volume` | number | `500` | Max USD rolling 24h total |

Examples:

```bash
# Raise daily limit to $1000
fence config set chain.sui.limits.max_24h_volume 1000

# Add CETUS to the approved token list
fence config set chain.sui.allowlist.tokens '["SUI","USDC","USDT","DEEP","BLUE","WAL","CETUS"]'

# View just the limits
fence config show chain.sui.limits
```

When setting array values, pass the full array as a JSON string — there is no "append" operation.

### Usage Statistics

```bash
fence stats [-d <days>] [-o json]
```

Shows command usage, success rates, and average durations over the last N days (default 30).

```json
{
  "totalCommands": 42,
  "successCount": 38,
  "avgDurationMs": 1250,
  "commandBreakdown": [
    { "command": "swap", "count": 20, "successRate": 0.95, "avgDurationMs": 2100 }
  ]
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `3` | Policy rejection (swap only) |
| `4` | Simulation failed (swap only) |

Check the exit code to distinguish between errors and policy rejections — both return JSON but mean different things.

## How to Handle Responses

1. **Parse the `status` field first.** It is always present: `success`, `rejected`, `simulated`, or `error`.
2. **On `rejected`**: read `check`, `reason`, and `detail` to understand why. Common fixes:
   - `token_not_allowed` → the token isn't in the allowlist. Ask the user if they want to add it via `fence config set`.
   - `exceeds_single_trade_limit` → reduce the trade amount, or ask the user to raise `max_single_trade`.
   - `exceeds_24h_volume` → the daily cap is reached. Show the user current vs. limit from `metadata` and ask if they want to raise it or wait.
3. **On `error`**: read `message`. Common causes: wallet not set up, wallet locked, network issues. Guide the user through the fix.
4. **On `simulated`**: the wallet is watch-only. The numbers are estimates. No real transaction was submitted.

## Supported Tokens (Default Allowlist)

SUI, USDC, USDT, DEEP, BLUE, WAL — all on Sui mainnet. The user can expand or restrict this list via config.

## Workflow Patterns

### First-time user

```bash
fence setup                              # interactive — user does this
fence unlock                             # unlock wallet for session
fence query balance -o json              # check what they have
fence query price SUI USDC -o json       # check current prices
fence swap SUI USDC 10                   # execute a trade
```

### Daily trading session

```bash
fence unlock --ttl 8h                    # start session
fence query balance -o json              # portfolio check
fence stats -o json                      # review recent activity
# ... execute swaps as needed ...
fence lock                               # end session when done
```

### Adjusting guardrails

```bash
fence config show chain.sui.limits       # see current limits
fence config set chain.sui.limits.max_24h_volume 1000
fence config show chain.sui.allowlist.tokens   # see allowed tokens
fence config set chain.sui.allowlist.tokens '["SUI","USDC","USDT","DEEP","BLUE","WAL","CETUS"]'
```

## Important Notes

- **Amounts are human-readable** when you pass them to `fence swap` (e.g., `10` means 10 SUI), but **returned amounts are in smallest units** (e.g., `10000000000` for 10 SUI with 9 decimals). Always divide by `10^decimals` when displaying to the user.
- **`fence setup` and `fence unlock` are interactive** — they prompt for passwords. Never try to pipe passwords or automate these. Tell the user to run them.
- **All guardrail checks happen automatically** on every swap. You do not need to manually check policy before calling `fence swap`.
- **USD price oracle can fail.** When it does, token allowlist checks still apply but USD-based spending limits are skipped (logged, not silently bypassed).
- **The `--verbose` global flag** enables debug logging to stderr. Useful for troubleshooting but noisy — only use when diagnosing issues.
