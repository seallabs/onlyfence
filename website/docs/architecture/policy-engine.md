---
sidebar_position: 2
title: Policy Engine
---

# Policy Engine

The policy engine is the core of OnlyFence. It runs a **pipeline of independent check functions** in sequence. Each check evaluates a trade intent and returns pass or reject.

## How It Works

Every action your agent requests goes through the policy pipeline before execution:

```mermaid
flowchart TD
    START([Trade Intent]) --> TOK{Token Allowlist\nboth tokens approved?}
    TOK -->|No| R1[REJECT]
    TOK -->|Yes| PRICE[Fetch USD price]
    PRICE --> SINGLE{Spending Limit\nunder per-trade limit?}
    SINGLE -->|No| R2[REJECT]
    SINGLE -->|Yes| VOL{Spending Limit\nunder 24h volume?}
    VOL -->|No| R3[REJECT]
    VOL -->|Yes| APPROVE[APPROVED]

    APPROVE --> QUOTE[Get swap quote]
    QUOTE --> SIM{Dry-run OK?}
    SIM -->|No| R4[REJECT]
    SIM -->|Yes| SIGN[Sign and Submit]
    SIGN --> LOG[Log to SQLite]
    LOG --> DONE([Return JSON])
```

## Check Interface

Every policy check implements the `PolicyCheck` interface:

```typescript
interface PolicyCheck {
  name: string;
  description: string;
  evaluate(intent: TradeIntent, ctx: PolicyContext): CheckResult;
}

interface CheckResult {
  status: 'pass' | 'reject';
  reason?: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}
```

## Current Checks

### Token Allowlist

Verifies both the source and destination tokens are in the configured allowlist.

```toml
[chain.sui.allowlist]
tokens = ["SUI", "USDC", "USDT", "DEEP", "BLUE", "WAL"]
```

### Spending Limit

Two-part check:
1. **Per-trade limit** — trade USD value must be under `max_single_trade`
2. **Daily volume** — rolling 24h total must stay under `max_24h_volume`

```toml
[chain.sui.limits]
max_single_trade = 200.0
max_24h_volume = 500.0
```

## Config-Driven Loading

Checks are registered based on which config sections exist. No config section = check not loaded.

## Adding a New Check

Adding a new guardrail requires three steps:

1. **Implement `PolicyCheck`** — one file
2. **Define config schema** — one TOML section
3. **Register in loader** — one line

Zero changes to existing checks or pipeline logic.

## Planned Checks

```mermaid
timeline
    title Guardrail Evolution
    MVP
        : Token Allowlist
        : Spending Limits
    Release 2
        : Token Denylist
        : Protocol Allowlist
        : Pool Denylist
    Release 3
        : Circuit Breaker
        : Frequency Limit
    Release 4
        : Cost-Basis P&L
        : Approval Gate
```

## Oracle Failure Handling

If the price oracle is unreachable after 3 retries:

- OnlyFence uses a **fail-closed** approach
- Falls back to cached price for up to 5 minutes
- If cache is stale or absent, the trade is **rejected**
- Token allowlist checks always apply regardless of oracle status
