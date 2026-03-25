# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.2.0] - 2026-03-25

Daemon tier, AlphaLend lending, activity query engine, wallet import by private key, expanded token registry, unified activities table, and TUI polish.

### Added

- **Daemon Tier** — background daemon with security hardening for persistent agent operation (#18)
- **Activity Query Engine** — structured DSL for agent-driven data access across all activity types (#19)
- **Import by Private Key** — wallet import via raw private key in addition to mnemonic (#20)
- **AlphaLend Integration** — lending/borrowing support via AlphaLend protocol (#14)
- **LP Pro Price Service** — replaced Noodles/CoinGecko with LP Pro for prices and metadata (#15)
- **Expanded Token Registry** — Sui token registry expanded from 6 to 97 tokens (#9)
- **Raw Coin Type Support** — accept raw coin types directly in swap and query commands (#7)
- **TUI Visual Polish** — Panel component and visual beautification for terminal dashboard (#11)
- **Claude Code Skill** — prompt to install Claude Code skill during setup (#10)
- **Account Balance Widget** — balance widget on TUI dashboard (#3)
- **Landing Page** — project landing page (#8)

### Changed

- **Unified Activities Table** — trades and lending unified into single activities table with ActivityLog (#17)
- **SDK Transaction Signing** — use SDK built-in transaction signing instead of manual signature construction (#21)
- **Bare Semver Convention** — use bare semver everywhere, dropped v-prefix convention (#5)

### Fixed

- Install script auto-setup and release pipeline (#4)
- Mnemonic input handling in wallet setup command (#6)
- PR CI workflow (#4)

### Docs

- Added media assets to README and simplified getting started (#16)
- `SECURITY.md` with vulnerability reporting policy
- `CONTRIBUTING.md` with development guidelines
- `CHANGELOG.md`

## [0.1.0] - 2026-03-18

Initial release of OnlyFence — agent wallet guardrails for DeFi.

### Added

- **Policy Engine** — composable pipeline with short-circuit evaluation
  - Token allowlist check (per-chain approved tokens)
  - Spending limit check (per-trade USD cap + rolling 24h volume)
- **Swap Execution** — end-to-end swap via 7K Aggregator on Sui
  - Optimal routing across Cetus, DeepBook, Bluefin, FlowX, Turbos
  - Dry-run simulation before signing
  - Slippage configuration
- **Transaction Pipeline** — generic `executePipeline` orchestrator with ActionBuilder and ActionBuilderRegistry
- **Wallet Management**
  - BIP-39 mnemonic generation and Ed25519 key derivation
  - Encrypted keystore (password-protected at rest)
  - Session-based unlock/lock model (`fence unlock`, `fence lock`)
  - Watch-only wallet support (`fence wallet watch`)
  - Wallet aliases with auto-generation, switch, and rename
- **Interactive TUI** — full-screen terminal dashboard (React/Ink)
  - Dashboard with account balance widget
  - Trade history, policy config, and wallet info screens
  - Styled setup wizard with logo and telemetry opt-in prompt
- **CLI Commands**
  - `fence setup` — interactive wallet + config + database setup
  - `fence swap <from> <to> <amount>` — policy-enforced swap
  - `fence query balance` — wallet balances
  - `fence query price <tokens>` — USD prices
  - `fence wallet list|watch|switch|rename` — wallet management
  - `fence config init|show|set` — TOML configuration
  - `fence unlock` / `fence lock` — session management
  - `--output json` flag for machine-readable agent integration
- **Trade Logging** — every trade attempt (approved or rejected) logged to SQLite with timestamps, amounts, USD values, and policy decisions
- **Coin Metadata Cache** — `CachedCoinMetadataService` with DB persistence for token decimals and metadata
- **Oracle Integration** — real-time USD pricing via CoinGecko with retry logic and graceful degradation
- **Observability**
  - Structured logging with Pino (rotating log files)
  - Sensitive data filtering (mnemonics, private keys never logged)
  - Opt-in error reporting via Sentry
  - Usage stats collection
- **Auto-Update** — version checking and self-update mechanism
- **MEV Protection Interface** — `MevProtector` with `NoOpMevProtector` placeholder for Sui
- **CAIP-2 Chain Identification** — standards-compliant chain ID format with on-chain coin type storage
- **Release Pipeline** — GitHub Actions CI/CD with cross-platform builds, install script validation, and npm publishing

### Infrastructure

- TypeScript strict mode with `noUncheckedIndexedAccess`
- ESLint strict type-checked config (no `any`, explicit return types, strict boolean expressions)
- Prettier formatting
- Husky pre-commit hooks (typecheck + format + lint-staged + test)
- Vitest test suite
- Cross-platform install script (`install.sh`)

[Unreleased]: https://github.com/seallabs/onlyfence/compare/0.2.0...HEAD
[0.2.0]: https://github.com/seallabs/onlyfence/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/seallabs/onlyfence/releases/tag/0.1.0
