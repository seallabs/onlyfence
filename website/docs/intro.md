---
sidebar_position: 1
slug: /intro
title: What is OnlyFence?
---

# What is OnlyFence?

OnlyFence is a **free, open-source DeFi toolkit** that gives your AI agent full onchain capabilities — **with safety guardrails built in from day one**.

Your agent can swap tokens, lend, borrow, open and close positions, and run complex strategies. OnlyFence makes sure it can **never go beyond the limits you set**.

Think of it like giving your AI agent a **company credit card with spending limits** instead of handing over your bank account.

## The Problem

AI agents need wallet access to trade, lend, borrow, and manage positions. But raw wallet access means:

- The agent can trade tokens you didn't approve
- There's no limit on how much it can spend
- A single bug or prompt injection can drain everything in seconds
- You have zero visibility into what it's actually doing

**You wouldn't give an employee unlimited access to the company funds.** So why give your AI agent unlimited access to your wallet?

## The Solution

OnlyFence gives your agent **everything it needs to execute DeFi strategies** — while keeping you in control.

```
Your AI Agent --> OnlyFence --> Blockchain
                     |
        +------------+------------+
        |  Token approved?        |
        |  Under trade limit?     |
        |  Under daily limit?     |
        |  Strategy allowed?      |
        +-------------------------+

  All checks pass --> action executes
  Any check fails --> action blocked, you stay safe
```

## Why OnlyFence?

| | Without OnlyFence | With OnlyFence |
|---|---|---|
| **DeFi capabilities** | Build everything yourself | Swap, lend, borrow, LP — out of the box |
| **Spending control** | Unlimited | You set per-trade and daily limits |
| **Token control** | Agent can trade anything | Only tokens you approve |
| **Visibility** | No idea what the agent is doing | Full history with audit log |
| **Your keys** | Often sent to a server | Stay on your computer, encrypted |
| **Infrastructure** | Usually needs a server or account | Runs 100% on your machine |
| **Cost** | Often paid service | Free and open source |

## Supported Chains

| Chain | Status | Exchanges |
|-------|--------|-----------|
| **Sui** | Live | Cetus, DeepBook, Bluefin, FlowX, Turbos (via 7K Aggregator) |
| **EVM** (Ethereum, Base, etc.) | Coming soon | |
| **Solana** | Coming soon | |

## What Can Your Agent Do?

| Action | Status | Description |
|--------|--------|-------------|
| **Swap** | Live | Trade tokens across multiple DEXes with best-price routing |
| **Check balance** | Live | Query wallet balances and token prices |
| **Lend** | Live | Supply assets to lending protocols to earn yield |
| **Borrow** | Live | Borrow against collateral for leveraged strategies |
| **Open position** | Coming soon | Enter leveraged long/short positions |
| **Close position** | Coming soon | Exit positions and take profit or cut losses |
| **LP (Liquidity)** | Coming soon | Deposit, withdraw, compound, and rebalance LP positions |
| **Stake** | Coming soon | Stake tokens for protocol rewards |

Every action goes through your safety rules first.
