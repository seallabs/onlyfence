---
name: onlyfence-cli
description: >
  How to use the OnlyFence CLI (`fence`) to execute DeFi actions on-chain with safety guardrails.
  Use this skill whenever the user asks to swap tokens, lend/borrow/supply/withdraw tokens,
  check wallet balances, query token prices, query activity history, analyze trading patterns,
  manage wallets, configure trading limits or token allowlists, start/stop the daemon,
  or perform any on-chain DeFi action through OnlyFence. Also use when the user mentions
  "fence", "OnlyFence", trading guardrails, DeFi safety rules, activity analysis, lending,
  AlphaLend, or wants an AI agent to interact with the Sui blockchain. If the user asks to
  "trade", "swap", "lend", "borrow", "supply", "repay", "check balance", "check price",
  "query activities", "show history", "analyze trades", "set spending limit", "start daemon",
  or "update fence" in the context of this project, this skill applies.
---

# OnlyFence CLI — Agent Usage Guide

OnlyFence is a local CLI tool (`fence`) that gives AI agents full DeFi capabilities on the Sui blockchain — with safety guardrails enforced on every action. You call `fence` commands via the shell, parse structured JSON output, and react to the results.

## First-Time Setup

Before any on-chain action, the user needs a wallet. Check if OnlyFence is set up:

```bash
fence config show 2>/dev/null
```

If this errors with "Configuration file not found" or "No primary wallet found", guide the user through setup:

```bash
fence setup
```

This is an **interactive wizard** — it prompts for wallet generation/import and password. Do not try to automate or pipe input to it. Tell the user to run it themselves and come back when done.

For **non-interactive environments** (Docker, CI, scripts), use flags:

```bash
# Generate new wallet
fence setup --password-file /run/secrets/pw --generate

# Import from mnemonic file
fence setup --password-file /run/secrets/pw --mnemonic-file /run/secrets/mn

# Import from stdin
echo "mnemonic phrase..." | fence setup --password-file /run/secrets/pw
```

Non-interactive setup outputs JSON with the wallet address (and mnemonic if `--generate` was used).

After setup, the user should unlock their wallet for the session:

```bash
fence unlock          # default 4h session
fence unlock --ttl 8h # longer session
```

Valid TTL values: `1h`, `2h`, `4h`, `8h`, `12h`, `24h`.

## Session Management

The wallet must be unlocked before signing transactions (swaps, lending). Read-only commands (query, config show, wallet list, stats) work without unlocking.

```bash
fence unlock            # prompts for password, creates 4h session
fence unlock --ttl 12h  # custom duration
fence lock              # end session immediately
```

## Execution Modes

OnlyFence runs in two modes. The CLI auto-detects which mode is active and routes commands accordingly.

**Standalone (default):** Each command runs in-process. Config is loaded fresh per invocation.

**Daemon mode:** A long-lived process holds config and trade state in memory. Trades are routed via IPC (Unix socket or TCP). Start the daemon with:

```bash
fence start              # foreground (Ctrl+C to stop)
fence start --detach     # background (prompts for password first)
fence stop               # stop a running daemon
fence status             # check if daemon is running
fence status -o json     # machine-readable status
fence restart            # stop + start — shows config diff, requires confirmation + password
```

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --detach` | — | Run daemon in background |
| `--tcp-host <host>` | `127.0.0.1` | TCP bind address |
| `--tcp-port <port>` | `19876` | TCP port |
| `--allow-remote` | — | Allow non-loopback connections (disabled by default) |
| `--password-file <path>` | — | Read password from file (Docker/k8s friendly) |
| `-y, --yes` | — | Skip confirmation prompt (still requires password) |

All password-requiring commands (`start`, `restart`) support consistent password resolution:
1. `FENCE_PASSWORD` env var (deleted immediately after reading)
2. `--password-file <path>` or `FENCE_PASSWORD_FILE` env var
3. Interactive terminal prompt (default)

**`fence restart` always shows a config diff** before applying. The user must confirm the changes and authenticate with their password. This protects against unauthorized config modifications.

## Unified Output Format

All pipeline-based commands (swap, lending) return a unified `CliOutput` JSON structure. Action-specific data is nested in the `payload` field.

```typescript
interface CliOutput<T> {
  status: PipelineStatus;    // "success" | "simulated" | "rejected" | "simulation_failed" | "error"
  action: ActivityAction;    // e.g., "trade:swap", "lending:supply"
  chainId: ChainId;          // e.g., "sui:mainnet"
  address: string;           // wallet address that executed the action
  gasUsed?: number;          // gas consumed (in MIST, the smallest SUI unit)
  txDigest?: string;         // on-chain transaction hash
  protocol?: string;         // e.g., "alphalend", "7k_meta_ag"
  payload?: T;               // action-specific data (see below)
  error?: string;            // human-readable error (status: "error")
  rejectionCheck?: string;   // which policy check failed (status: "rejected")
  rejectionReason?: string;  // why the check failed (status: "rejected")
}
```

**Always use `--output json`** (or rely on the default) to get machine-parseable results.

## Core Commands

### Swap Tokens

```bash
fence swap <fromToken> <toToken> <amount> [options]
```

| Argument | Description |
|----------|-------------|
| `fromToken` | Source token symbol (e.g., `SUI`) |
| `toToken` | Destination token symbol (e.g., `USDC`) |
| `amount` | Amount in human-readable format (e.g., `10`, `0.5`) |

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --slippage <percent>` | `0.5` | Slippage tolerance in percent |
| `-c, --chain <chain>` | `sui` | Target chain |
| `-o, --output <format>` | `json` | Output format (only `json` supported) |

#### Success response

```json
{
  "status": "success",
  "action": "trade:swap",
  "chainId": "sui:mainnet",
  "address": "0x7a3f...e821",
  "gasUsed": 2100,
  "txDigest": "8Hk4...mW2p",
  "payload": {
    "fromToken": "0x2::sui::SUI",
    "toToken": "0xdba3...::usdc::USDC",
    "amountIn": 10,
    "amountOut": 9.812,
    "valueUsd": 98.0
  }
}
```

The `payload.amountIn` and `payload.amountOut` are **human-readable numbers** (e.g., `10` means 10 SUI, not 10 MIST).

#### Policy rejection response (exit code 3)

```json
{
  "status": "rejected",
  "action": "trade:swap",
  "chainId": "sui:mainnet",
  "address": "0x7a3f...e821",
  "rejectionCheck": "spending_limit",
  "rejectionReason": "exceeds_24h_volume"
}
```

Possible `rejectionCheck` values: `token_allowlist`, `spending_limit`
Possible `rejectionReason` values:
- `token_not_allowed` — token not in the configured allowlist
- `exceeds_single_trade_limit` — single trade exceeds `max_single_trade`
- `exceeds_24h_volume` — rolling 24h total would exceed `max_24h_volume`

#### Simulated response (watch-only wallet, exit code 0)

```json
{
  "status": "simulated",
  "action": "trade:swap",
  "chainId": "sui:mainnet",
  "address": "0x7a3f...e821",
  "payload": {
    "fromToken": "0x2::sui::SUI",
    "toToken": "0xdba3...::usdc::USDC",
    "amountIn": 10,
    "amountOut": 9.812,
    "valueUsd": 98.0
  }
}
```

#### Simulation failed response (exit code 4)

```json
{
  "status": "simulation_failed",
  "action": "trade:swap",
  "chainId": "sui:mainnet",
  "address": "0x7a3f...e821",
  "error": "Insufficient balance for swap"
}
```

#### Error response (exit code 1)

```json
{
  "status": "error",
  "action": "trade:swap",
  "chainId": "sui:mainnet",
  "address": "",
  "error": "Human-readable error description"
}
```

### Lending (AlphaLend)

OnlyFence supports lending operations via AlphaLend. Policy checks (token allowlist and spending limits) apply to supply operations.

```bash
fence lend supply <token> <amount> [options]    # supply tokens as collateral
fence lend borrow <token> <amount> [options]    # borrow against collateral
fence lend withdraw <token> <amount> [options]  # withdraw supplied tokens
fence lend repay <token> <amount> [options]     # repay borrowed tokens
fence lend claim [options]                      # claim accumulated rewards
fence lend markets                              # list all AlphaLend markets
fence lend market <token>                       # detailed market info for a token
fence lend portfolio [options]                  # show user lending positions
```

| Option | Default | Description |
|--------|---------|-------------|
| `-m, --market <marketId>` | — | Specific market ID (auto-resolved if omitted) |
| `-c, --chain <chain>` | `sui` | Target chain |
| `-a, --all` | — | Withdraw all (withdraw only) |

#### Lending success response

```json
{
  "status": "success",
  "action": "lending:supply",
  "chainId": "sui:mainnet",
  "address": "0x7a3f...e821",
  "gasUsed": 3200,
  "txDigest": "9Jk5...nX3q",
  "protocol": "alphalend",
  "payload": {
    "token": "0x2::sui::SUI",
    "amount": 100,
    "marketId": "0xabc...def",
    "valueUsd": 98.0
  }
}
```

Lending responses follow the same unified output pattern as swaps: `success`, `simulated`, `rejected`, `simulation_failed`, or `error`. Policy checks apply to `supply` (token allowlist + spending limits). Borrow, withdraw, repay, and claim are not subject to spending limits.

#### Claim rewards response

```json
{
  "status": "success",
  "action": "lending:claim_rewards",
  "chainId": "sui:mainnet",
  "address": "0x7a3f...e821",
  "gasUsed": 1500,
  "txDigest": "2Lm8...pR4s",
  "protocol": "alphalend",
  "payload": {
    "valueUsd": 5.23,
    "rewards": {
      "SUI": { "amount": 1.5, "valueUsd": 1.47 }
    }
  }
}
```

### Query Balance

```bash
fence query balance [-c <chain>] [-o <format>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-c, --chain <chain>` | `sui` | Target chain |
| `-o, --output <format>` | `table` | `json` or `table` |

**Use `-o json`** for machine-parseable output:

```json
{
  "address": "0x7a3f...e821",
  "balances": [
    { "token": "SUI", "amount": "1000000000", "decimals": 9 },
    { "token": "USDC", "amount": "500000000", "decimals": 6 }
  ]
}
```

The `amount` field in balance queries is in the **smallest unit**. To get human-readable values, divide by `10^decimals` (e.g., `1000000000` SUI with 9 decimals = `1.0` SUI). This is different from swap/lending output where amounts are already human-readable.

### Query Price

```bash
fence query price <tokens...> [-o <format>]
```

Pass one or more token symbols separated by spaces:

```bash
fence query price SUI USDC DEEP -o json
```

```json
[
  { "token": "SUI", "priceUsd": 0.98 },
  { "token": "USDC", "priceUsd": 1.0 },
  { "token": "UNKNOWN", "priceUsd": null, "error": "Token not found" }
]
```

### Wallet Management

```bash
fence wallet list [-o json]          # list all wallets
fence wallet watch <address> [-c sui] [-a <alias>]  # add watch-only wallet
fence wallet switch <alias>          # set primary wallet
fence wallet rename <old> <new>      # rename a wallet
fence wallet import-key [-a <alias>] # import wallet from private key (interactive)
```

Watch-only wallets can simulate swaps and lending but cannot sign real transactions. `import-key` is interactive — it prompts for the private key securely.

### Configuration & Safety Rules

```bash
fence config show [key]              # show full config or a specific key
fence config set <key> <value>       # update a config value
fence config init [-f]               # create default config (--force to overwrite)
```

**IMPORTANT — Config changes do NOT auto-apply in daemon mode:**

`fence config set` writes to the config file on disk, but the daemon holds its own frozen config snapshot in memory. **If the daemon is running, changes are NOT effective until the user runs `fence restart`.** The command shows a diff of what changed and requires the user to confirm with their password.

**You (the agent) cannot apply config changes by yourself.** After running `fence config set`, you MUST tell the user:

1. The config file has been updated, but is **not yet active** in the daemon.
2. They need to run `fence restart` to review the diff and restart with their password.
3. This is a security feature — it prevents unauthorized config changes from taking effect silently.

**Never tell the user the config change is already in effect when the daemon is running.** The CLI will print a reminder, but you should also proactively warn the user.

In **standalone mode** (no daemon), config changes take effect on the next command automatically.

Keys use dot-notation. The important safety settings:

| Key | Type | Default | Ceiling | Description |
|-----|------|---------|---------|-------------|
| `chain.sui.allowlist.tokens` | string[] | `["SUI","USDC","USDT","DEEP","BLUE","WAL"]` | — | Only these tokens can be traded |
| `chain.sui.limits.max_single_trade` | number | `200` | `10000` | Max USD value per trade |
| `chain.sui.limits.max_24h_volume` | number | `500` | `100000` | Max USD rolling 24h total |
| `update.auto_install` | boolean | `true` | — | Auto-install updates on check |
| `telemetry.enabled` | boolean | `true` | — | Enable error reporting |

Examples:

```bash
# Raise daily limit to $1000
fence config set chain.sui.limits.max_24h_volume 1000

# Add CETUS to the approved token list
fence config set chain.sui.allowlist.tokens '["SUI","USDC","USDT","DEEP","BLUE","WAL","CETUS"]'

# View just the limits
fence config show chain.sui.limits

# Disable automatic updates
fence config set update.auto_install false
```

When setting array values, pass the full array as a JSON string — there is no "append" operation. Ceiling values are hard upper bounds that cannot be exceeded via config.

### Query Activities

Flexible querying of all DeFi activity history (trades, lending, LP, perp, staking) with filtering, aggregation, sorting, and grouping.

```bash
fence query activities [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --select <cols>` | all | Comma-separated columns or aggregations (`SUM(value_usd)`, `COUNT(*)`) |
| `-f, --filter <expr>` | — | Repeatable. `column=op=value` (ops: `eq`,`neq`,`gt`,`lt`,`gte`,`lte`,`in`,`like`,`between`) |
| `-g, --group-by <cols>` | — | Comma-separated GROUP BY columns |
| `--having <expr>` | — | Repeatable. Same format as filter |
| `--order-by <expr>` | — | Repeatable. `column=asc` or `column=desc` |
| `-l, --limit <n>` | `100` | Max rows (1-1000) |
| `--offset <n>` | `0` | Pagination offset |
| `--no-resolve-tokens` | — | Skip token symbol/decimal resolution (faster for aggregations) |
| `-o, --output <format>` | `table` | `json` or `table` |

Filters use `=` as delimiter (not `:`) because Sui coin types contain `::`. For `in`/`between`, comma-separate values: `category=in=trade,lending`. For `like`, use `%` as wildcard: `action=like=%swap%`.

**Key columns:** `category` (trade/lending/lp/perp/staking), `action` (trade:swap, lending:supply, ...), `protocol`, `value_usd`, `gas_cost`, `policy_decision` (approved/rejected), `token_a_symbol`, `token_b_symbol`, `created_at`. Use `--no-resolve-tokens` when you only need aggregations — symbol columns require the join.

**JSON output:** `{ columns: [...], rows: [...], totalCount: number }`. `totalCount` is the full count, not capped by limit.

**Use `-o json`** for machine-parseable output. `chain_id` is auto-filtered by `--chain`.

**Gotchas:**
- **Timestamps are space-separated** (`2026-03-23 00:00:00`), not ISO `T`-format. Always use `YYYY-MM-DD HH:MM:SS` in date filters.
- **`action` is always `category:action` format** (e.g., `trade:swap`, `lending:supply`). Filter with `eq=trade:swap`, not bare `swap`.

#### Examples

```bash
# Recent swaps
fence query activities -f action=eq=trade:swap --order-by created_at=desc -l 20 -o json

# Volume by category
fence query activities -s category,COUNT\(*\),SUM\(value_usd\) -g category --no-resolve-tokens -o json

# Yesterday's volume (use space-separated timestamps)
fence query activities -f 'created_at=gte=2026-03-23 00:00:00' -f 'created_at=lt=2026-03-24 00:00:00' -s 'COUNT(*),SUM(value_usd)' --no-resolve-tokens -o json

# Rejected activities
fence query activities -s action,rejection_reason,value_usd -f policy_decision=eq=rejected -o json

# Lending activity
fence query activities -f category=eq=lending --order-by created_at=desc -l 20 -o json
```

#### Programmatic Usage

```typescript
import { createActionExecutor } from './core/action-executor.js';
import type { SwapIntent } from './core/action-types.js';

// The executor transparently routes to in-process or daemon execution
const executor = createActionExecutor(getComponents);
const result = await executor.execute({
  chainId: 'sui:mainnet',
  action: 'trade:swap',
  walletAddress: '',  // resolved automatically
  params: {
    coinTypeIn: 'SUI',
    coinTypeOut: 'USDC',
    amountIn: '10',
    slippageBps: 50,
  },
} satisfies SwapIntent);

// result.pipelineResult.status — "success" | "simulated" | "rejected" | ...
// result.walletAddress — resolved wallet address
// result.tradeValueUsd — USD value if available
```

For activity queries:

```typescript
import { executeActivityQuery } from './db/activity-query-tool.js';
const result = executeActivityQuery(db, {
  select: ['category', 'SUM(value_usd)'],
  filters: [{ column: 'policy_decision', op: 'eq', value: 'approved' }],
  groupBy: ['category'],
  resolveTokens: false,
});
```

Tool schema for LLM function-calling: `getActivityQueryToolSchema()`.

#### Common Agent Workflows

**PnL calculation:** Query swap activities for token amounts/costs, then `fence query price` for current prices. Compare `value_usd` at swap time vs current token value.

```bash
# 1. Get all swap details
fence query activities -f action=like=%swap% -s token_a_symbol,token_b_symbol,token_a_amount,token_b_amount,token_a_decimals,token_b_decimals,value_usd -o json
# 2. Get current prices for tokens involved
fence query price SUI WAL USDC -o json
# 3. Calculate: current_value = (amount / 10^decimals) * current_price, PnL = current_value - value_usd
```

**Portfolio overview:** Combine balance + prices + lending positions for full holdings value.

```bash
# 1. Get all balances
fence query balance -o json
# 2. Price the meaningful tokens (filter out zero balances and dust)
fence query price SUI USDC WAL CETUS DEEP -o json
# 3. Check lending positions
fence lend portfolio -o json
# 4. Calculate: value = (amount / 10^decimals) * price, sum for total portfolio
```

### Usage Statistics

```bash
fence stats [-d <days>] [-o json]
```

Shows command usage, success rates, and average durations over the last N days (default 30).

```json
{
  "totalCommands": 42,
  "successCount": 38,
  "avgDurationMs": 1250,
  "commandBreakdown": [
    { "command": "swap", "count": 20, "successRate": 0.95, "avgDurationMs": 2100 }
  ]
}
```

### Updates & Maintenance

```bash
fence update              # check for and install updates from GitHub Releases
fence update --check-only # check only, don't install
fence uninstall           # remove OnlyFence completely (config, keystore, daemon, logs, shell PATH, Claude plugin)
fence uninstall -y        # skip confirmation prompt
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success or simulated |
| `1` | General error |
| `3` | Policy rejection (swap/lending only) |
| `4` | Simulation failed (swap/lending only) |

Check the exit code to distinguish between errors and policy rejections — both return JSON but mean different things.

## How to Handle Responses

1. **Parse the `status` field first.** It is always present: `success`, `rejected`, `simulated`, `simulation_failed`, or `error`.
2. **On `rejected`**: read `rejectionCheck` and `rejectionReason` to understand why. Common fixes:
   - `token_not_allowed` → the token isn't in the allowlist. Ask the user if they want to add it via `fence config set`.
   - `exceeds_single_trade_limit` → reduce the trade amount, or ask the user to raise `max_single_trade`.
   - `exceeds_24h_volume` → the daily cap is reached. Show the user the current limit and ask if they want to raise it or wait.
3. **On `error`**: read `error`. Common causes: wallet not set up, wallet locked, network issues. Guide the user through the fix.
4. **On `simulation_failed`**: the transaction simulation failed on-chain (e.g., insufficient balance, invalid parameters). Read `error` for details.
5. **On `simulated`**: the wallet is watch-only. The numbers are estimates. No real transaction was submitted.
6. **On `success`**: read `payload` for action-specific data, `txDigest` for the on-chain transaction hash, and `gasUsed` for gas consumed.

## Supported Tokens (Default Allowlist)

SUI, USDC, USDT, DEEP, BLUE, WAL — all on Sui mainnet. The user can expand or restrict this list via config.

## Supported Actions

| Category | Actions | Status |
|----------|---------|--------|
| Trade | `trade:swap` | Live |
| Lending | `lending:supply`, `lending:borrow`, `lending:withdraw`, `lending:repay`, `lending:claim_rewards` | Live |
| LP | `lp:deposit`, `lp:withdraw` | Planned |
| Perps | `perp:open_long`, `perp:open_short`, `perp:close_position` | Planned |
| Staking | `staking:stake`, `staking:unstake` | Planned |

## Workflow Patterns

### First-time user

```bash
fence setup                              # interactive — user does this
fence unlock                             # unlock wallet for session
fence query balance -o json              # check what they have
fence query price SUI USDC -o json       # check current prices
fence swap SUI USDC 10                   # execute a trade
```

### Daily trading session

```bash
fence unlock --ttl 8h                    # start session
fence query balance -o json              # portfolio check
fence stats -o json                      # review recent activity
# ... execute swaps as needed ...
fence lock                               # end session when done
```

### Lending workflow

```bash
fence lend markets                       # see available markets
fence lend market SUI                    # check SUI market rates
fence lend supply SUI 100                # supply 100 SUI as collateral
fence lend borrow USDC 50               # borrow 50 USDC
fence lend portfolio                     # check positions
fence lend repay USDC 50                 # repay loan
fence lend withdraw SUI 100 --all       # withdraw all collateral
fence lend claim                         # claim rewards
```

### Daemon mode

```bash
fence start --detach                     # start daemon in background
fence status -o json                     # verify it's running
# ... all commands auto-route through daemon ...
fence restart                            # restart with new config (shows diff, needs password)
fence stop                               # shut down daemon
```

### Adjusting guardrails

```bash
fence config show chain.sui.limits       # see current limits
fence config set chain.sui.limits.max_24h_volume 1000
fence config show chain.sui.allowlist.tokens   # see allowed tokens
fence config set chain.sui.allowlist.tokens '["SUI","USDC","USDT","DEEP","BLUE","WAL","CETUS"]'

# If daemon is running, changes are NOT active until:
fence restart                            # review diff and restart with password
```

## Important Notes

- **Swap and lending output amounts are human-readable** — `payload.amountIn: 10` means 10 SUI, not 10 MIST. No conversion needed when displaying to the user.
- **Balance query amounts are in smallest units** — `"amount": "1000000000"` with `"decimals": 9` means 1.0 SUI. Divide by `10^decimals` for display.
- **`fence setup`, `fence unlock`, and `fence wallet import-key` are interactive** — they prompt for passwords or keys. Never try to pipe passwords or automate these (except non-interactive setup with `--password-file`). Tell the user to run them.
- **All guardrail checks happen automatically** on every swap and lending supply. You do not need to manually check policy before calling `fence swap` or `fence lend supply`.
- **USD price oracle can fail.** When it does, token allowlist checks still apply but USD-based spending limits are skipped (logged, not silently bypassed).
- **Config changes require user action in daemon mode** — `fence config set` only writes to the file on disk. The daemon does NOT auto-reload. The user must run `fence restart` to review the diff and apply changes with their password. Never claim a config change is active without this step.
- **Config ceilings exist** — `max_single_trade` cannot exceed $10,000 and `max_24h_volume` cannot exceed $100,000, regardless of what the user sets.
- **The `--verbose` global flag** enables debug logging to stderr. Useful for troubleshooting but noisy — only use when diagnosing issues.
