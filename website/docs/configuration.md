---
sidebar_position: 4
title: Configuration
description: Configure OnlyFence safety rules — spending limits, token allowlists, volume caps, and chain settings in a simple TOML config file.
---

# Configuration

OnlyFence uses a TOML config file stored at `~/.onlyfence/config.toml`. This file controls all safety rules, chain settings, and behavior.

## View Current Config

```bash
fence config show
```

## Default Config

```toml
[chain.sui]
rpc = "https://fullnode.mainnet.sui.io:443"

[chain.sui.allowlist]
tokens = ["SUI", "USDC", "USDT", "DEEP", "BLUE", "WAL"]

[chain.sui.limits]
max_single_trade = 200.0
max_24h_volume = 500.0
```

## Config Reference

### Token Allowlist

Controls which tokens your agent is allowed to trade. Any token not in this list is blocked.

```toml
[chain.sui.allowlist]
tokens = ["SUI", "USDC", "USDT", "DEEP", "BLUE", "WAL"]
```

You can also use raw coin types:

```toml
tokens = ["SUI", "0x2::sui::SUI", "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"]
```

### Spending Limits

Controls how much your agent can spend.

```toml
[chain.sui.limits]
max_single_trade = 200.0   # Maximum USD value for a single trade
max_24h_volume = 500.0     # Maximum total USD volume in a rolling 24-hour window
```

### RPC Endpoint

```toml
[chain.sui]
rpc = "https://fullnode.mainnet.sui.io:443"
```

## Modifying Config

### Via CLI

```bash
# Set a single value
fence config set chain.sui.limits.max_24h_volume 1000

# Set an array value
fence config set chain.sui.allowlist.tokens '["SUI", "USDC", "USDT"]'
```

### Via File

Edit `~/.onlyfence/config.toml` directly with any text editor.

:::tip
After editing the file directly, run `fence config show` to verify your changes are valid.
:::

## Re-initialize Config

To reset to defaults:

```bash
fence config init
```

## Future Config Options

These config sections are planned for future releases:

```toml
# Token denylist — block specific tokens
[chain.sui.denylist]
tokens = ["SCAM", "RUG"]

# Protocol allowlist — restrict to specific DEXes
[chain.sui.protocol_allowlist]
protocols = ["cetus", "deepbook", "7k"]

# Circuit breaker — auto-halt on losses
[chain.sui.circuit_breaker]
max_loss_24h = 100.0
max_consecutive_losses = 5
cooldown = "1h"

# Trade frequency limit
[chain.sui.frequency_limit]
max_trades_per_hour = 30
```
