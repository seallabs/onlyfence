---
title: "Why We Built OnlyFence: AI Agents Need Wallets. Wallets Need Guardrails."
description: AI agents can now trade, lend, and borrow on-chain — but giving them your wallet is a massive risk. OnlyFence is the open-source toolkit that lets agents operate with guardrails, not blank checks.
slug: why-we-built-onlyfence
authors: [onlyfence]
tags: [manifesto, ai-agents, defi, security, open-source]
image: /img/blog/why-we-built-onlyfence.png
keywords:
  - AI agent trading
  - DeFi safety
  - autonomous agent wallet
  - prompt injection crypto
  - onchain agent guardrails
  - AI agent DeFi toolkit
  - crypto spending limits
  - open source DeFi
  - AI agent security
  - multi-chain agent
---

# AI Agents Are Coming for Your Wallet. That's a Good Thing — If You Set the Rules.

![Why We Built OnlyFence](/img/blog/why-we-built-onlyfence.png)

The agent revolution is here. Tools like Cowork and OpenClaw let AI agents analyze markets, form strategies, and act — all without you lifting a finger. Now point that at DeFi: an agent that can swap tokens at the right moment, supply collateral when rates spike, or rebalance a portfolio while you sleep.

**That's real edge.** The kind that used to require a quant team and a Bloomberg terminal.

But here's the catch no one talks about enough.

<!-- truncate -->

## The Wallet Problem

For an agent to do anything on-chain, it needs your wallet. Your private keys. Your funds.

And the moment you hand those over, you're trusting that:

- The agent won't make trades you didn't approve
- No one can manipulate it through prompt injection
- A single hallucination won't drain your entire balance
- The platform holding your keys won't get breached

That's a lot of trust for a system that, by design, makes autonomous decisions.

**One bad prompt. One exploited endpoint. One compromised plugin.** That's all it takes. We've seen it happen — agents tricked into signing malicious transactions, wallets drained in seconds, users left with nothing.

This isn't a theoretical risk. It's the #1 reason most serious traders won't let agents near their funds.

## We Built OnlyFence to Fix This

OnlyFence is a free, open-source DeFi toolkit where **the agent is treated as a threat actor by default**.

Not because agents are evil. Because good security assumes they could be.

The idea is simple: your agent gets full DeFi capabilities — swap, lend, borrow, manage positions — but every action passes through rules **you** define. If it breaks a rule, the action is blocked. No exceptions.

```
Agent wants to swap 10,000 USDC → SUI

  ✓ Token approved?     SUI is on the allowlist
  ✓ Under trade limit?  $200 max per trade → BLOCKED

  Action denied. Funds safe. You get notified.
```

Think of it as a **company credit card with spending limits** — not handing over the company bank account.

## What We Got Right (and Why It Matters to You)

### 1. Safety as the Default, Not an Add-on

Most tools give you power first and let you figure out safety later. We flipped it.

Every agent interaction goes through a local policy engine — no server, no API call, no latency. Rules are checked in microseconds:

- **Token allowlist** — the agent can only touch tokens you approve
- **Per-trade limits** — cap every single transaction (default: $200)
- **Daily volume caps** — limit total exposure over 24 hours (default: $500)
- **Simulation before execution** — every trade is dry-run on-chain before signing
- **Full audit trail** — every action logged, approved or rejected

Your keys never leave your machine. They're encrypted locally with your password. No cloud. No backend. No middleman.

### 2. A Real DeFi Toolkit, Not Just a Wrapper

Here's what separates OnlyFence from a simple transaction signer: it's a complete DeFi layer.

Your agent doesn't need to know how Cetus works, or how to route through DeepBook, or how to calculate optimal lending rates on AlphaLend. OnlyFence handles it:

- **Swap** across 5+ DEXes with best-price routing via 7K Aggregator
- **Lend and earn** — supply assets to lending protocols
- **Borrow against collateral** — leveraged strategies, managed safely
- **Check prices and balances** — real-time data, no third-party API keys

One interface. All of DeFi. The agent sends a simple command, OnlyFence does the heavy lifting.

```bash
# Your agent just says:
fence swap SUI USDC 100

# OnlyFence handles: routing, simulation, limit checks, signing, confirmation
```

### 3. Multi-Chain from Day One

We didn't build for one chain and bolt on others later. The architecture is chain-agnostic from the core — every module outside the chain layer is designed to work across networks.

**Today:** Sui is live with full support.
**Next:** EVM chains (Ethereum, Base, Arbitrum) and Solana are in the pipeline.

One toolkit. One config. Multiple chains.

### 4. Built for Agents. Works for Everyone.

OnlyFence ships with built-in skills for Claude, ChatGPT, and custom agents — so integration is minutes, not days.

But we know not everyone runs agents the same way:

| You are... | Your setup |
|---|---|
| Trying agents for the first time | One command install on Mac, Linux, or Windows |
| A developer building a trading bot | JSON CLI output, pipe it into anything |
| Running a production agent fleet | Docker container with security hardening |
| Deploying at scale | Kubernetes with Vault or AWS Secrets Manager |

Every output is structured JSON. Every action is auditable. Whether you're experimenting on your laptop or running 50 agents in production, the toolkit scales with you.

## Who Is This For?

**If you're exploring AI agents for on-chain opportunities** — OnlyFence lets you experiment without risking your funds. Set tight limits, start small, watch the audit log. Expand as you gain confidence.

**If you're a developer building agent workflows** — stop writing wallet management, transaction signing, and safety checks from scratch. OnlyFence gives you a tested, open-source foundation to build on.

**If you're running agents in production** — you need guardrails that don't add latency, keys that never leave your infrastructure, and a complete audit trail. That's what this is.

## The Bottom Line

AI agents on-chain are not a question of *if* — it's *when*. The edge they provide is too significant to ignore. But the current model of "give the agent your keys and hope for the best" is broken.

**OnlyFence is the guardrail layer between your agent and your wallet.** Open source. Local-first. Free.

The agent trades. You set the rules. Your funds stay safe.

---

**Get started in 30 seconds:**

```bash
curl -fsSL https://raw.githubusercontent.com/seallabs/onlyfence/main/install.sh | sh
```

[Read the docs →](/docs/intro) | [View on GitHub →](https://github.com/seallabs/onlyfence)
