<p align="center">
  <img src="static/img/logo/png/logo-512.png" width="160" alt="OnlyFence logo — AI crypto trading safety tool" />
</p>

<h1 align="center">OnlyFence</h1>

<p align="center">
  <strong>Safe, full-featured DeFi toolkit for AI agents.</strong><br />
  <sub>Guardrails first. Swap, lend, borrow, and manage positions — without risking your wallet.</sub>
</p>

<p align="center">
  <a href="#install"><img src="https://img.shields.io/badge/install-one%20command-brightgreen?style=for-the-badge" alt="One command install" /></a>
  <a href="#"><img src="https://img.shields.io/badge/version-0.1.0-blue?style=for-the-badge" alt="v0.1.0" /></a>
  <a href="#supported-chains"><img src="https://img.shields.io/badge/chain-Sui-4da2ff?style=for-the-badge" alt="Sui blockchain" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GNU%20GPLv3-22c55e?style=for-the-badge" alt="GNU GPLv3" /></a>
</p>

---

## What is OnlyFence?

OnlyFence is a **free, open-source DeFi toolkit** that gives your AI agent full onchain capabilities — **with safety guardrails built in from day one**.

Your agent can swap tokens, lend, borrow, open and close positions, and run complex strategies. OnlyFence makes sure it can **never go beyond the limits you set**.

Think of it like giving your AI agent a **company credit card with spending limits** instead of handing over your bank account.

<p align="center">
  <img src="static/img/hero.png" width="720" alt="Without OnlyFence vs With OnlyFence — AI trading safety comparison" />
</p>

### The Problem

AI agents need wallet access to trade, lend, borrow, and manage positions. But raw wallet access means:

- The agent can trade tokens you didn't approve
- There's no limit on how much it can spend
- A single bug or prompt injection can drain everything in seconds
- You have zero visibility into what it's actually doing

**You wouldn't give an employee unlimited access to the company funds.** So why give your AI agent unlimited access to your wallet?

### The Solution

OnlyFence gives your agent **everything it needs to execute DeFi strategies** — while keeping you in control.

```
Your AI Agent → OnlyFence → Blockchain
                   │
      ┌────────────┴────────────┐
      │  ✅ Token approved?      │
      │  ✅ Under trade limit?   │
      │  ✅ Under daily limit?   │
      │  ✅ Strategy allowed?    │
      └─────────────────────────┘

  All checks pass → action executes
  Any check fails → action blocked, you stay safe
```

<p align="center">
  <video src="static/video/demo.mp4" width="720" controls alt="OnlyFence demo — setup, swap, and spending limit block"></video>
</p>

---

## What Can Your Agent Do With OnlyFence?

| Action | Status | Description |
|--------|--------|-------------|
| **Swap** | Live | Trade tokens across multiple DEXes with best-price routing |
| **Check balance** | Live | Query wallet balances and token prices |
| **Lend** | Coming soon | Supply assets to lending protocols to earn yield |
| **Borrow** | Coming soon | Borrow against collateral for leveraged strategies |
| **Open position** | Coming soon | Enter leveraged long/short positions |
| **Close position** | Coming soon | Exit positions and take profit or cut losses |
| **LP (Liquidity)** | Coming soon | Deposit, withdraw, compound, and rebalance LP positions |
| **Stake** | Coming soon | Stake tokens for protocol rewards |

Every action goes through your safety rules first. Your agent gets rich DeFi capabilities — you keep full control.

<p align="center">
  <img src="static/img/diagram/defi_agent_guardrails.png" width="720" alt="Diagram — AI agent connected to DeFi actions through OnlyFence guardrails" />
</p>

---

## Why OnlyFence?

| | Without OnlyFence | With OnlyFence |
|---|---|---|
| **DeFi capabilities** | Build everything yourself | Swap, lend, borrow, LP — out of the box |
| **Spending control** | Unlimited — agent can spend everything | You set per-trade and daily limits |
| **Token control** | Agent can trade anything | Only tokens you approve |
| **Visibility** | No idea what the agent is doing | Full history with audit log |
| **Your keys** | Often sent to a server | Stay on your computer, encrypted |
| **Infrastructure** | Usually needs a server or account | Nothing — runs 100% on your machine |
| **Cost** | Often paid service | Free and open source |

---

## Install

One command. Takes about 30 seconds.

```sh
curl -fsSL https://raw.githubusercontent.com/seallabs/onlyfence/main/install.sh | sh
```

That's it. No account needed. No sign-up. No credit card.

<p align="center">
  <img src="static/gif/install.gif" width="720" alt="Terminal recording of OnlyFence install script" />
</p>

<details>
<summary><strong>Install a specific version</strong></summary>

```sh
curl -fsSL https://raw.githubusercontent.com/seallabs/onlyfence/main/install.sh | ONLYFENCE_VERSION=0.1.0 sh
```

</details>

<details>
<summary><strong>Build from source</strong></summary>

Requires Node.js >= 25.

```sh
git clone https://github.com/seallabs/onlyfence.git
cd onlyfence
npm install && npm run build
```

</details>

### Requirements

- **macOS** (Intel or Apple Silicon) or **Linux** (x64 or ARM64)
- No other dependencies — Node.js runtime is bundled

---

## Getting Started

The installer runs `fence setup` automatically, so your wallet is ready to go after install.

> **Important:** Write down the mnemonic phrase shown during install and keep it somewhere safe. This is the only way to recover your wallet. OnlyFence will never show it again.

### Step 1: Set Your Rules

Your safety rules are in a simple config file. The defaults are sensible, but you can change them anytime:

```sh
fence config show
```

```toml
[chain.sui.allowlist]
tokens = ["SUI", "USDC", "USDT", "DEEP", "BLUE", "WAL"]   # Only these tokens can be traded

[chain.sui.limits]
max_single_trade = 200.0     # No single trade above $200
max_24h_volume   = 500.0     # No more than $500 per day total
```

**Change a rule:**
```sh
# Allow up to $1000 per day
fence config set chain.sui.limits.max_24h_volume 1000

# Add a new token to the approved list
fence config set chain.sui.allowlist.tokens '["SUI", "USDC", "USDT", "DEEP", "BLUE", "WAL", "CETUS"]'
```

### Step 2: Let Your Agent Work

```sh
# Swap tokens — guardrails check every trade automatically
fence swap SUI USDC 10

# Check wallet balance
fence query balance

# Get token prices
fence query price SUI,USDC

# Coming soon: lend, borrow, open positions, and more
# fence lend SUI 100 --protocol navi
# fence borrow USDC 50 --collateral SUI
```

Your agent calls these commands and gets structured JSON responses. Every action is checked against your rules before it touches the chain.

### Step 3: Open the Dashboard

You don't have to use the command line for everything. OnlyFence includes a **full interactive dashboard** right in your terminal — just run:

```sh
fence
```

From the dashboard you can:
- **See your balances** and portfolio at a glance
- **Browse trade history** — every action your agent took, with status
- **View and change your safety rules** — no need to edit config files manually
- **Manage wallets** — switch between wallets, check addresses

<p align="center">
  <img src="static/gif/tui.gif" width="720" alt="OnlyFence TUI dashboard — walkthrough of tabs" />
</p>

---

## How It Works

When your agent calls any OnlyFence command, here's what happens:

```
1. 📋 Load your safety rules from config
2. ✅ Check: is the token on your approved list?
3. ✅ Check: is this under your per-trade limit?
4. ✅ Check: would this put you over your daily limit?
5. 💰 Find the best execution route (across multiple exchanges)
6. 🧪 Simulate first (dry run — no real money yet)
7. ✍️ Sign and submit the transaction
8. 📝 Log everything (so you can review later)
```

If **any** check fails, the action is blocked. Your money stays safe.

Every action — approved or rejected — is saved in a local database so you always have a complete audit trail. This works the same whether your agent is swapping, lending, borrowing, or managing positions.

---

## Connecting Your AI Agent

OnlyFence works with **any AI agent** — ChatGPT, Claude, custom bots, or your own scripts. Instead of building blockchain logic yourself, your agent calls `fence` commands and gets structured JSON back.

**Your agent runs a command like:**
```sh
fence swap SUI USDC 100 --output json
```

**If the action is approved:**
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
  "route": "SUI → USDC via Cetus"
}
```

**If the action is blocked by your rules:**
```json
{
  "status": "rejected",
  "check": "spending_limit",
  "reason": "exceeds_24h_volume",
  "detail": "24h $480 + $98 = $578 exceeds $500 limit"
}
```

The agent reads the response and adjusts its strategy — no ambiguity, no guessing. Your agent gets the DeFi building blocks; you set the boundaries.

### Claude Code / Codex Integration

If you use [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://openai.com/index/codex/), or other AI coding agents, OnlyFence provides a native plugin and skill — no manual CLI wiring needed.

**Install the plugin:**
```sh
claude plugin marketplace add seallabs/onlyfence
claude plugin install onlyfence@onlyfence
```

Once installed, your coding agent can call OnlyFence commands directly — swap tokens, check balances, enforce guardrails — all within the agent's natural workflow. The same safety rules apply: every action is checked against your policy before it touches the chain.

---

## Two Ways to Use OnlyFence

### Interactive Dashboard (for you)

Run `fence` to open the full-screen dashboard. Browse your balances, trade history, and safety rules visually — no commands to memorize.

Perfect for monitoring what your agent is doing and tweaking rules on the fly.

### CLI Commands (for your agent)

Your AI agent calls `fence` commands with `--output json` to get structured responses. This is how the agent interacts with DeFi — safely.

| Command | What it does |
|---------|-------------|
| `fence` | Open the interactive dashboard |
| `fence swap SUI USDC 10` | Swap tokens (with safety checks) |
| `fence query balance` | See your wallet balance |
| `fence query price SUI,USDC` | Check token prices in USD |
| `fence wallet list` | See all your wallets |
| `fence config show` | View your current rules |
| `fence config set <key> <value>` | Change a rule |
| `fence unlock` | Unlock your wallet for the session |
| `fence lock` | Lock your wallet |

---

## Supported Chains

| Chain | Status | Exchanges |
|-------|--------|-----------|
| **Sui** | Live | Cetus, DeepBook, Bluefin, FlowX, Turbos (via 7K Aggregator) |
| **EVM** (Ethereum, Base, etc.) | Coming soon | |
| **Solana** | Coming soon | |

---

## FAQ

<details>
<summary><strong>Is OnlyFence free?</strong></summary>

Yes, 100% free and open source. No hidden fees, no premium tier, no account needed.

</details>

<details>
<summary><strong>Is my wallet safe?</strong></summary>

Your private keys are encrypted and stored locally on your computer. They never leave your machine. OnlyFence doesn't have servers — everything runs locally.

</details>

<details>
<summary><strong>What if I lose my mnemonic phrase?</strong></summary>

If you lose your mnemonic, you lose access to your wallet. OnlyFence cannot recover it for you. Write it down and store it somewhere safe when you first run `fence setup`.

</details>

<details>
<summary><strong>Can I use my existing wallet?</strong></summary>

Yes. During `fence setup`, choose "Import existing private key or mnemonic" to use a wallet you already have.

</details>

<details>
<summary><strong>What happens if the price oracle is down?</strong></summary>

If OnlyFence can't fetch USD prices, it still enforces your token allowlist. USD-based spending limits are skipped (not silently bypassed — this is logged). Your token restrictions always apply.

</details>

<details>
<summary><strong>Does OnlyFence charge any fees on trades?</strong></summary>

No. OnlyFence doesn't take any fees. You only pay the normal blockchain gas fees and any DEX fees from the swap itself.

</details>

<details>
<summary><strong>Can I run this on a server / VPS?</strong></summary>

Yes. OnlyFence is a CLI tool, so it runs anywhere Node.js runs — your laptop, a VPS, a Raspberry Pi, etc.

</details>

---

## Roadmap

What's coming next:

**More DeFi actions:**
- **Lending & borrowing** — supply assets to earn yield, borrow against collateral
- **Position management** — open/close leveraged long/short positions
- **LP operations** — deposit, withdraw, compound, and rebalance liquidity
- **Staking** — stake tokens for protocol rewards

**More guardrails:**
- **Token denylist** — block specific tokens instead of maintaining an allowlist
- **Trade frequency limits** — prevent too many trades in a short period
- **P&L-based circuit breaker** — auto-stop the agent when losses hit a threshold

**More chains:**
- **EVM** (Ethereum, Base, Arbitrum, etc.)
- **Solana**

**More control:**
- **Telegram alerts** — get notified when actions happen or get blocked
- **Telegram approval gate** — manually approve actions from your phone
- **P&L tracking** — see your profit/loss in real time

---

## Security

- Private keys are encrypted at rest with your password
- Mnemonics are shown once during setup and never stored in plaintext
- All policy evaluation happens locally — no data leaves your machine
- Every transaction is simulated before signing (dry run)
- Full audit trail of every trade attempt

See [SECURITY.md](SECURITY.md) for our vulnerability reporting policy.

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

<p align="center">
  <img src="static/img/logo/png/logo-72.png" width="36" alt="OnlyFence" />
  <br />
  <sub>Built by <a href="https://github.com/seallabs">Seal Labs</a> &middot; Powered by <a href="https://7k.ag">7K DeFi</a></sub>
  <br />
  <sub>
    <a href="#install">Install</a> &middot;
    <a href="#getting-started">Getting Started</a> &middot;
    <a href="#all-commands">Commands</a> &middot;
    <a href="#faq">FAQ</a> &middot;
    <a href="https://github.com/seallabs/onlyfence/issues">Report a Bug</a>
  </sub>
</p>
