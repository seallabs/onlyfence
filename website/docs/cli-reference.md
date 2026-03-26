---
sidebar_position: 5
title: CLI Reference
description: Complete reference for all OnlyFence CLI commands — swap, query, lend, wallet, config, daemon, and more.
---

# CLI Reference

OnlyFence provides the `fence` command with subcommands for trading, querying, wallet management, and configuration.

## Global Flags

| Flag | Description |
|------|-------------|
| `--output json` | Return structured JSON (for agent integration) |
| `--chain <chain>` | Target chain (default: `sui`) |
| `--addr <host:port>` | Connect to a remote daemon instead of running locally |
| `--version` | Show version |
| `--help` | Show help |

## Commands

### `fence`

Opens the interactive terminal dashboard (TUI). Browse balances, trade history, safety rules, and wallet info visually.

```bash
fence
```

### `fence setup`

Interactive wallet and configuration setup. Run automatically during install.

```bash
fence setup
```

**Options:**

| Flag | Description |
|------|-------------|
| `--generate` | Generate a new wallet (outputs JSON with mnemonic) |
| `--mnemonic-file <path>` | Import mnemonic from file |
| `--password-file <path>` | Read password from file (non-interactive) |

**Non-interactive mode** (for CI/scripts):

```bash
# Import from file
fence setup --mnemonic-file /run/secrets/mnemonic --password-file /run/secrets/password

# Import from stdin
echo "word1 word2 ..." | fence setup --password-file /run/secrets/password

# Generate new wallet
fence setup --generate --password-file /run/secrets/password
```

### `fence swap`

Execute a token swap with policy enforcement.

```bash
fence swap <from> <to> <amount> [options]
```

**Example:**

```bash
fence swap SUI USDC 10
fence swap SUI USDC 100 --output json
```

**Output (JSON):**

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

**Rejection example:**

```json
{
  "status": "rejected",
  "check": "spending_limit",
  "reason": "exceeds_24h_volume",
  "detail": "24h $480 + $98 = $578 exceeds $500 limit"
}
```

### `fence lend`

Interact with lending protocols.

```bash
fence lend supply <token> <amount>    # Supply assets to earn yield
fence lend borrow <token> <amount>    # Borrow against collateral
fence lend withdraw <token> <amount>  # Withdraw supplied assets
fence lend repay <token> <amount>     # Repay borrowed assets
```

### `fence query balance`

Show wallet balances.

```bash
fence query balance
fence query balance --output json
```

### `fence query price`

Get current USD prices for tokens.

```bash
fence query price SUI,USDC,DEEP
fence query price SUI --output json
```

### `fence query activity`

Query the activity log with structured filters.

```bash
fence query activity --type swap --status success --limit 10
fence query activity --output json
```

### `fence config`

Manage configuration.

```bash
fence config show               # Show current config
fence config set <key> <value>  # Set a config value
fence config init                # Reset to default config
```

### `fence wallet`

Manage wallets.

```bash
fence wallet list       # List all wallets
fence wallet watch      # Add a watch-only wallet
fence wallet switch     # Switch active wallet
fence wallet rename     # Rename a wallet
fence wallet import-key # Import wallet by private key
```

### `fence unlock` / `fence lock`

Manage wallet session.

```bash
fence unlock   # Unlock wallet for the session (prompts for password)
fence lock     # Lock wallet
```

### `fence start` / `fence stop`

Manage the background daemon.

```bash
fence start    # Start the daemon
fence stop     # Stop the daemon
fence status   # Check daemon status
fence reload   # Reload configuration
```

### `fence update`

Check for and install updates.

```bash
fence update
```

### `fence uninstall`

Remove OnlyFence from your system.

```bash
fence uninstall
```
