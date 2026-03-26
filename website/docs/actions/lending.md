---
sidebar_position: 2
title: Lending & Borrowing
description: Supply, withdraw, borrow, and repay tokens on Sui via AlphaLend integration. All lending actions go through OnlyFence safety guardrails.
---

# Lending & Borrowing

OnlyFence integrates with the AlphaLend protocol on Sui for lending and borrowing operations. Supply tokens to earn yield, borrow against your collateral, or repay outstanding loans — all with the same safety guardrails that protect your swaps.

## Commands

### Supply Assets

Supply tokens to earn yield:

```bash
fence lend supply <token> <amount>
fence lend supply SUI 100 --output json
```

### Borrow Assets

Borrow against your supplied collateral:

```bash
fence lend borrow <token> <amount>
fence lend borrow USDC 50 --output json
```

### Withdraw

Withdraw your supplied assets:

```bash
fence lend withdraw <token> <amount>
fence lend withdraw SUI 50 --output json
```

### Repay

Repay borrowed assets:

```bash
fence lend repay <token> <amount>
fence lend repay USDC 25 --output json
```

## Supported Protocols

| Protocol | Chain | Status |
|----------|-------|--------|
| AlphaLend | Sui | Live |

## Safety Checks

Lending and borrowing actions go through the same policy engine as swaps:

- **Token allowlist** — the token must be in your approved list
- **Spending limits** — the USD value of the operation is checked against your limits

All lending actions are logged in the activity history alongside swaps.
