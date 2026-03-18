<p align="center">
  <img src="static/img/logo/png/logo-512.png" width="160" alt="OnlyFence — pixel art blue octopus logo" />
</p>

<h1 align="center">OnlyFence</h1>

<p align="center">
  <strong>Agent Wallet Guardrails for DeFi</strong><br />
  <sub>Standalone CLI &middot; Zero Infrastructure &middot; Multi-Chain</sub>
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?style=flat-square" alt="Node.js >=23" /></a>
  <a href="#"><img src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square" alt="v0.1.0" /></a>
  <a href="#supported-chains"><img src="https://img.shields.io/badge/chain-Sui-4da2ff?style=flat-square" alt="Sui" /></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict" /></a>
  <a href="#"><img src="https://img.shields.io/badge/infra-zero-22c55e?style=flat-square" alt="Zero infrastructure" /></a>
</p>

<p align="center">
  <code>npm install -g onlyfence</code> &mdash; set your limits &mdash; let the agent trade within the fence.
</p>

---

## The Problem

AI trading agents hold raw private keys with unlimited access. A single prompt injection can drain the wallet. Wallet owners have zero visibility into what the agent is doing — every trade is fire-and-forget.

## The Solution

OnlyFence sits between the agent and the blockchain. Every trade passes through a configurable policy pipeline **locally** before it touches the chain. No server, no account, no infrastructure — just `npm install` and go.

```
Agent → fence swap SUI USDC 100 → Policy Engine → Blockchain
                                       │
                           ┌───────────┴───────────┐
                           │  Token allowlist  ✅/❌ │
                           │  Spending limits  ✅/❌ │
                           │  24h volume cap   ✅/❌ │
                           └───────────────────────┘
```

## Features

- **Policy Engine** — Composable pipeline of safety checks, short-circuits on first rejection. Drop in new checks without modifying existing code.
- **Token Allowlist** — Only approved tokens can be traded, per chain.
- **Spending Limits** — Per-trade USD cap + rolling 24-hour volume limit.
- **Wallet Management** — BIP-39 mnemonic generation, Ed25519/secp256k1 key derivation, encrypted keystores.
- **Full Audit Trail** — Every trade attempt (approved or rejected) logged to SQLite with timestamps, amounts, and policy decisions.
- **Interactive TUI** — Full-screen terminal dashboard with live policy config, trade history, and wallet info.
- **Oracle Integration** — Real-time USD pricing with retry logic and graceful degradation.
- **JSON Output** — Machine-readable output for agent integration (`--output json`).
- **Zero Infrastructure** — Everything runs locally. No backend, no database server, no hosted services.
- **Powered by 7K Aggregator** — Optimal swap routing across all major Sui DEXes (Cetus, DeepBook, Bluefin, FlowX, Turbos).

## Quick Start

### Install

```bash
git clone https://github.com/seallabs/onlyfence.git
cd onlyfence
npm install && npm run build
```

### Setup

```bash
fence setup
```

```
? How would you like to set up your wallet?
  ▸ Generate new wallet (recommended)
    Import existing private key or mnemonic

✓ Wallet generated. Back up this mnemonic:
  abandon ability able about above ...

  Sui:    0x7a3f...e821

✓ Keystore encrypted. Saved to ~/.onlyfence/keystore
✓ Config initialized at ~/.onlyfence/config.toml
✓ Database initialized at ~/.onlyfence/trades.db
```

### Trade

```bash
# Swap 10 SUI for USDC — policy checks run automatically
fence swap SUI USDC 10

# Check wallet balance
fence query balance

# Get token prices
fence query price SUI,USDC
```

### Interactive Dashboard

```bash
# Launch TUI (run fence with no arguments)
fence
```

```
╭──────────────────────────────────────────────────────────────╮
│ <1> Dashboard  <2> Trades  <3> Policy  <4> Wallet  <q> Quit │
│                                                              │
│   ▀▀▀▀▀                                                     │
│   ▀█▀█▀█   OnlyFence          Release Notes                 │
│   ▀▀ ▀▀ ▀   AI Trading        ────────────────────────────  │
│   ▄ ▄ ▄ ▄   Guardrails        v0.1.0  Initial release       │
╰──────────────────────────────────────────────────────────────╯
```

## Configuration

All policy rules live in TOML at `~/.onlyfence/config.toml`. Rules are per-chain because tokens, protocols, and pool addresses differ across blockchains.

```toml
[chain.sui]
rpc = "https://fullnode.mainnet.sui.io"

[chain.sui.allowlist]
tokens = ["SUI", "USDC", "USDT", "DEEP", "BLUE", "WAL"]

[chain.sui.limits]
max_single_trade = 200.0     # USD per trade
max_24h_volume   = 500.0     # USD rolling 24h cap
```

```bash
fence config init                                    # Create default config
fence config show                                    # View current config
fence config set chain.sui.limits.max_single_trade 500  # Update a value
```

## How It Works

```
┌─ OnlyFence CLI ─────────────────────────────────┐
│                                                  │
│  TOML Config  →  Policy Engine (in-process)      │
│  SQLite DB    →  Trade Log + Rolling Volume      │
│  Keystore     →  Sign & Submit                   │
│  Oracle       →  USD Value Resolution            │
│  Chain Adapter →  7K Aggregator (Sui)            │
│                                                  │
└──────────────────────────────────────────────────┘
```

When an agent calls `fence swap`, the entire sequence executes within the CLI:

1. **Load policy** — read TOML config for the target chain
2. **Token allowlist** — are both tokens in the allowlist? If not → **REJECT**
3. **Spending limit** — fetch USD price, check per-trade max, check rolling 24h volume → **REJECT** if over
4. **Get swap quote** — call 7K Aggregator for best route
5. **Simulate** — dry-run via Sui RPC. If fails → **REJECT**
6. **Sign and submit** — sign with local key, submit to network
7. **Log trade** — write to SQLite (tokens, amounts, USD value, tx digest, gas, policy decision)
8. **Return JSON** — structured response to agent

## CLI Reference

| Command | Description |
|---------|-------------|
| `fence` | Launch interactive TUI |
| `fence setup` | Wallet + config + database setup wizard |
| `fence swap <from> <to> <amount>` | Execute swap with policy enforcement |
| `fence query price <tokens>` | Get USD prices for tokens |
| `fence query balance` | Check wallet balances |
| `fence wallet list` | List all registered wallets |
| `fence config init` | Create default config |
| `fence config show [key]` | Display configuration |
| `fence config set <key> <value>` | Update a config value |

### Swap Options

```bash
fence swap SUI USDC 100 \
  --slippage 0.5 \       # Max slippage % (default: 0.5)
  --chain sui \           # Target chain
  --output json           # Machine-readable output for agents
```

### JSON Output

```jsonc
// Success
{
  "status": "success",
  "chain": "sui",
  "txDigest": "8Hk4...mW2p",
  "fromToken": "SUI", "toToken": "USDC",
  "amountIn": "100", "amountOut": "98.12",
  "valueUsd": 98.0, "gasCost": 0.0021,
  "route": "SUI → USDC via Cetus"
}

// Rejection
{
  "status": "rejected",
  "check": "spending_limit",
  "reason": "exceeds_24h_volume",
  "detail": "24h $480 + $98 = $578 exceeds $500 limit"
}
```

## Architecture

```
┌──────────────────────────────────────────────────┐
│                   CLI / TUI                       │
├──────────────────────────────────────────────────┤
│                 Policy Engine                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────┐ │
│  │ Token        │  │ Spending     │  │  ...   │ │
│  │ Allowlist    │→ │ Limits       │→ │ Custom │ │
│  └──────────────┘  └──────────────┘  └────────┘ │
├──────────────────────────────────────────────────┤
│         Chain Adapters          │    Oracle       │
│  ┌─────┐  ┌─────┐  ┌────────┐  │  ┌───────────┐ │
│  │ Sui │  │ EVM │  │ Solana │  │  │ CoinGecko │ │
│  └─────┘  └─────┘  └────────┘  │  └───────────┘ │
├──────────────────────────────────────────────────┤
│  Wallet (BIP-39 / Ed25519)  │  Database (SQLite) │
└──────────────────────────────────────────────────┘
```

### Extending the Policy Engine

Adding a guardrail requires: (1) implement the interface, (2) define a config section, (3) register — one line. Zero changes to existing checks or pipeline.

```typescript
import type { PolicyCheck } from 'onlyfence';

export class MyCheck implements PolicyCheck {
  readonly name = 'my-check';

  async evaluate(intent: TradeIntent, ctx: PolicyContext): Promise<CheckResult> {
    // Your logic here
    return { status: 'pass' };
  }
}

// Register — that's it
registry.register(new MyCheck());
```

### Adding a New Chain

```typescript
import type { ChainAdapter } from 'onlyfence';

export class EvmAdapter implements ChainAdapter {
  readonly chain = 'evm';
  async getBalance(address: string): Promise<BalanceResult> { /* ... */ }
  async getSwapQuote(params: SwapParams): Promise<SwapQuote> { /* ... */ }
  async buildSwapTx(quote: SwapQuote): Promise<TransactionData> { /* ... */ }
  async simulateTx(tx: TransactionData): Promise<SimulationResult> { /* ... */ }
  async signAndSubmit(tx: TransactionData, signer: Signer): Promise<TxResult> { /* ... */ }
}
```

## Supported Chains

| Chain | Status | Execution Backend |
|-------|--------|-------------------|
| **Sui** | **Live** | 7K Aggregator (Cetus, DeepBook, Bluefin, FlowX, Turbos) |
| **EVM** | Planned | 1inch / 0x + viem |
| **Solana** | Planned | Jupiter |

## Wallet Model

OnlyFence uses BIP-39 to derive addresses across chains from a single mnemonic. Per-chain key import is also supported.

| Chain | Curve | Derivation Path | Address Format |
|-------|-------|-----------------|----------------|
| Sui | ed25519 | `m/44'/784'/0'/0'/0'` | `0xabc...` (32 bytes, hex) |
| EVM | secp256k1 | `m/44'/60'/0'/0/0` | `0x123...` (20 bytes, hex) |
| Solana | ed25519 | `m/44'/501'/0'/0'` | `7Kx3...` (base58) |

## Roadmap

| Release | Features |
|---------|----------|
| **MVP** (current) | Token allowlist, spending limits, swap execution, TUI, wallet management |
| **v2** | Token denylist, protocol allowlist, pool denylist |
| **v3** | Circuit breaker, trade frequency limiter |
| **v4** | Cost-basis P&L tracking, P&L-based circuit breaker |
| **v5** | Telegram notifications, Telegram approval gate |
| **v6** | LP operations (deposit, withdraw, compound, rebalance) via 7K LP Pro |
| **v7** | EVM + Solana chain adapters, global cross-chain policy |

## Comparison

| Feature | OnlyFence | Coinbase Agentic | Openfort | Bitget Skill |
|---------|-----------|------------------|----------|--------------|
| Multi-chain | Sui + EVM + SVM | EVM (Base) | 25+ EVM | Partial |
| Agent-first CLI | Yes | No | No | No |
| Policy guardrails | Full suite | Yes | Yes | No |
| Standalone (no server) | Yes | No | No | No |
| Open source | Yes | — | — | — |

## Development

```bash
npm run dev          # Run with tsx (no compile)
npm run build        # Compile TypeScript
npm run typecheck    # Type checking
npm run lint         # ESLint
npm run format       # Prettier
npm test             # Vitest
npm run test:watch   # Watch mode
```

### Project Structure

```
src/
├── cli/          # Command parser and subcommands
├── tui/          # Interactive terminal UI (React/Ink)
├── policy/       # Policy engine, check interface, registry
├── chain/        # Chain adapters (Sui via 7K Aggregator)
├── oracle/       # Price oracle (CoinGecko)
├── wallet/       # BIP-39, key derivation, encrypted keystores
├── db/           # SQLite database, trade log, migrations
├── config/       # TOML config loading and validation
├── types/        # Core type definitions
└── utils/        # Shared utilities
```

## Security

- **Encrypted keystore** — Private keys encrypted at rest, password-protected at `~/.onlyfence/keystore.json`
- **Mnemonics shown once** — Displayed during setup, never stored in plaintext
- **Local-only execution** — All policy evaluation happens in-process. No data leaves the machine except the transaction itself
- **Dry-run simulation** — Every transaction is simulated via RPC before signing
- **Graceful oracle degradation** — If the oracle is unreachable, trades proceed but only token allowlist is enforced; USD limits are skipped, not silently bypassed

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Follow existing patterns — SOLID, DRY, strict TypeScript
4. Add tests for new functionality
5. Run `npm run format && npm run lint && npm test`
6. Open a pull request

---

<p align="center">
  <img src="static/img/logo/png/logo-72.png" width="36" alt="OnlyFence" />
  <br />
  <sub>Built by <a href="https://github.com/seallabs">Seal Labs</a> &middot; Powered by <a href="https://7k.ag">7K Aggregator</a></sub>
</p>
