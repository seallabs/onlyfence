---
sidebar_position: 13
title: Changelog
---

# Changelog

All notable changes to OnlyFence are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-03-25

Daemon tier, AlphaLend lending, activity query engine, wallet import by private key, expanded token registry, unified activities table, and TUI polish.

### Added

- **Daemon Tier** — background daemon with security hardening for persistent agent operation
- **Activity Query Engine** — structured DSL for agent-driven data access across all activity types
- **Import by Private Key** — wallet import via raw private key in addition to mnemonic
- **AlphaLend Integration** — lending/borrowing support via AlphaLend protocol
- **LP Pro Price Service** — replaced Noodles/CoinGecko with LP Pro for prices and metadata
- **Expanded Token Registry** — Sui token registry expanded from 6 to 97 tokens
- **Raw Coin Type Support** — accept raw coin types directly in swap and query commands
- **TUI Visual Polish** — Panel component and visual beautification for terminal dashboard
- **Claude Code Skill** — prompt to install Claude Code skill during setup
- **Account Balance Widget** — balance widget on TUI dashboard
- **Landing Page** — project landing page

### Changed

- **Unified Activities Table** — trades and lending unified into single activities table with ActivityLog
- **SDK Transaction Signing** — use SDK built-in transaction signing instead of manual signature construction
- **Bare Semver Convention** — use bare semver everywhere, dropped v-prefix convention

### Fixed

- Install script auto-setup and release pipeline
- Mnemonic input handling in wallet setup command
- PR CI workflow

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
- **Transaction Pipeline** — generic `executePipeline` orchestrator
- **Wallet Management**
  - BIP-39 mnemonic generation and Ed25519 key derivation
  - Encrypted keystore (password-protected at rest)
  - Session-based unlock/lock model
  - Watch-only wallet support
  - Wallet aliases with auto-generation, switch, and rename
- **Interactive TUI** — full-screen terminal dashboard (React/Ink)
- **CLI Commands** — swap, query, wallet, config, unlock/lock
- **Trade Logging** — every trade attempt logged to SQLite
- **Oracle Integration** — real-time USD pricing with retry logic
- **Observability** — structured logging with Pino, Sentry integration
- **Auto-Update** — version checking and self-update mechanism

[0.2.0]: https://github.com/seallabs/onlyfence/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/seallabs/onlyfence/releases/tag/0.1.0
