---
sidebar_position: 6
title: Agent Integration
description: Connect any AI agent to OnlyFence — Claude, ChatGPT, custom bots, or scripts. Structured JSON output for seamless integration.
---

# Agent Integration

OnlyFence works with **any AI agent** — Claude, ChatGPT, custom bots, or your own scripts. Your agent calls `fence` commands and gets structured JSON back.

## How It Works

Instead of building blockchain logic yourself, your agent calls `fence` commands with `--output json`:

```bash
fence swap SUI USDC 100 --output json
```

The agent reads the JSON response and adjusts its strategy — no ambiguity, no guessing.

## Response Format

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
  "check": "spending_limit",
  "reason": "exceeds_24h_volume",
  "detail": "24h $480 + $98 = $578 exceeds $500 limit"
}
```

The agent can inspect the `check`, `reason`, and `detail` fields to understand **why** an action was blocked and adjust accordingly.

## Claude Code / Codex Integration

If you use [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://openai.com/index/codex/), or other AI coding agents, OnlyFence provides a native plugin and skill — no manual CLI wiring needed.

### Install the Plugin

```bash
claude plugin marketplace add seallabs/onlyfence
claude plugin install onlyfence@onlyfence
```

Once installed, your coding agent can call OnlyFence commands directly — swap tokens, check balances, enforce guardrails — all within the agent's natural workflow.

## Daemon Mode

For persistent agent connections, run OnlyFence as a background daemon:

```bash
fence start
```

Your agent connects via TCP:

```bash
fence swap SUI USDC 100 --addr 127.0.0.1:19876 --output json
```

See [Daemon Mode](./daemon) for details.

## Integration Patterns

### Simple Script

```bash
#!/bin/bash
# Agent trading script

RESULT=$(fence swap SUI USDC 10 --output json)
STATUS=$(echo "$RESULT" | jq -r '.status')

if [ "$STATUS" = "success" ]; then
  echo "Trade executed: $(echo "$RESULT" | jq -r '.txDigest')"
elif [ "$STATUS" = "rejected" ]; then
  echo "Trade blocked: $(echo "$RESULT" | jq -r '.detail')"
fi
```

### Query Before Trading

```bash
# Check balance first
BALANCE=$(fence query balance --output json)

# Check current price
PRICE=$(fence query price SUI --output json)

# Execute trade if conditions are met
fence swap SUI USDC 50 --output json
```

### Activity History

```bash
# Get recent trades
fence query activity --type swap --limit 5 --output json

# Get all rejected actions
fence query activity --status rejected --output json
```

## System Prompt Example

When configuring your AI agent's system prompt, you can include instructions like:

```
You have access to OnlyFence for DeFi operations on Sui.

Available commands:
- fence swap <from> <to> <amount> --output json
- fence query balance --output json
- fence query price <tokens> --output json
- fence lend supply <token> <amount> --output json
- fence lend borrow <token> <amount> --output json
- fence query activity --output json

Always use --output json for structured responses.
If a trade is rejected, read the "detail" field to understand why
and adjust your strategy accordingly.
```
