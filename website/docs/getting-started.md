---
sidebar_position: 3
title: Getting Started
description: Set up OnlyFence in minutes — configure safety rules, execute your first swap, and open the terminal dashboard.
keywords: [getting started, setup guide, first swap, DeFi tutorial, AI agent setup, OnlyFence quickstart]
---

# Getting Started

The installer runs `fence setup` automatically, so your wallet is ready to go after install.

:::warning
Write down the mnemonic phrase shown during setup and keep it somewhere safe. This is the only way to recover your wallet. OnlyFence will never show it again.
:::

## Step 1: Set Your Rules

Your safety rules are in a simple config file. The defaults are sensible, but you can change them anytime:

```bash
fence config show
```

```toml
[chain.sui.allowlist]
tokens = ["SUI", "USDC", "USDT", "DEEP", "BLUE", "WAL"]   # Only these tokens can be traded

[chain.sui.limits]
max_single_trade = 200.0     # No single trade above $200
max_24h_volume   = 500.0     # No more than $500 per day total
```

### Change a Rule

```bash
# Allow up to $1000 per day
fence config set chain.sui.limits.max_24h_volume 1000

# Add a new token to the approved list
fence config set chain.sui.allowlist.tokens '["SUI", "USDC", "USDT", "DEEP", "BLUE", "WAL", "CETUS"]'
```

## Step 2: Let Your Agent Work

```bash
# Swap tokens — guardrails check every trade automatically
fence swap SUI USDC 10

# Check wallet balance
fence query balance

# Get token prices
fence query price SUI,USDC

# Lend tokens to earn yield
fence lend supply SUI 100

# Borrow against collateral
fence lend borrow USDC 50
```

Your agent calls these commands and gets structured JSON responses. Every action is checked against your rules before it touches the chain.

## Step 3: Open the Dashboard

OnlyFence includes a **full interactive dashboard** right in your terminal:

```bash
fence
```

From the dashboard you can:
- **See your balances** and portfolio at a glance
- **Browse trade history** — every action your agent took, with status
- **View and change your safety rules** — no need to edit config files manually
- **Manage wallets** — switch between wallets, check addresses

## How It Works

When your agent calls any OnlyFence command, here's what happens:

1. Load your safety rules from config
2. Check: is the token on your approved list?
3. Check: is this under your per-trade limit?
4. Check: would this put you over your daily limit?
5. Find the best execution route (across multiple exchanges)
6. Simulate first (dry run — no real money yet)
7. Sign and submit the transaction
8. Log everything (so you can review later)

If **any** check fails, the action is blocked. Your money stays safe.

Every action — approved or rejected — is saved in a local database so you always have a complete audit trail.
