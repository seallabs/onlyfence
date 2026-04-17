---
name: onlyfence-cli
description: >
  How to use the OnlyFence CLI (`fence`) to execute DeFi actions on-chain with safety guardrails.
  Use this skill whenever the user asks to swap tokens, lend/borrow/supply/withdraw tokens,
  check wallet balances, query token prices, query activity history, analyze trading patterns,
  manage wallets, configure trading limits or token allowlists, trade perpetual futures,
  open/close perp positions, place limit/market orders, check funding rates, manage margin deposits,
  start/stop the daemon, or perform any on-chain DeFi action through OnlyFence.
  Also use when the user mentions "fence", "OnlyFence", trading guardrails, DeFi safety rules,
  activity analysis, lending, AlphaLend, Jupiter, Aave, Paraswap, Hyperliquid, Bluefin,
  perpetual, perp, leverage, margin, funding rate, or wants an AI agent to interact with
  Sui, Solana, or Ethereum from a single tool. If the user asks to
  "trade", "swap", "lend", "borrow", "supply", "repay", "long", "short",
  "check balance", "check price", "open position", "close position", "place order",
  "query activities", "show history", "analyze trades", "set spending limit", "start daemon",
  or "update fence" in the context of this project, this skill applies.
---

# OnlyFence CLI — Agent Usage Guide

OnlyFence is a local CLI tool (`fence`) that gives AI agents full DeFi capabilities on **multiple chains** — Sui, Solana, and Ethereum mainnet — with safety guardrails enforced on every action. You call `fence` commands via the shell, parse structured JSON output, and react to the results.

## Supported Chains and Protocols

| Chain | Swap | Lending | Perpetuals |
|-------|------|---------|------------|
| **Sui** (`sui`) | 7K Aggregator | AlphaLend | Bluefin Pro |
| **Solana** (`solana`) | Jupiter | Jupiter Lend | Jupiter Perps |
| **Ethereum** (`ethereum`) | Paraswap | Aave V3 | Hyperliquid |

The CAIP-2 chain IDs are `sui:mainnet`, `solana:mainnet`, and `ethereum:mainnet`.

A user can configure one, two, or all three chains. Every command accepts `-c, --chain <chain>` to target a specific chain — when omitted, the default resolves from `config.default_chain` (or the first configured chain).

## First-Time Setup

Before any on-chain action, the user needs at least one chain configured and a wallet for it. Check setup state:

```bash
fence config show 2>/dev/null
```

If this errors with "Configuration file not found" or "No primary wallet found", guide the user through setup:

```bash
fence setup
```

This is an **interactive 7-step wizard** that:
1. Initializes the local SQLite database
2. Creates a default config (if none exists)
3. **Prompts for chain selection** (sui / solana / ethereum)
4. Collects required credentials for the chosen chain (e.g., `JUPITER_API_KEY` for Solana)
5. Prompts to **generate a new wallet**, **import a mnemonic**, or **import a private key**
6. Encrypts and saves the keystore (or merges into an existing one)
7. Asks about automatic updates and anonymous error reporting

Do not try to automate or pipe input to the wizard. Tell the user to run it themselves and come back when done. **To add another chain after the first**, the user re-runs `fence setup` — the wizard appends to the existing keystore using the password.

For **non-interactive environments** (Docker, CI, scripts), use flags:

```bash
# Generate new wallet for Sui
fence setup --chain sui --password-file /run/secrets/pw --generate

# Import from mnemonic file for Solana (JUPITER_API_KEY must be in env)
JUPITER_API_KEY=... fence setup --chain solana \
  --password-file /run/secrets/pw \
  --mnemonic-file /run/secrets/mn

# Import from stdin for Ethereum
echo "mnemonic phrase..." | fence setup --chain ethereum --password-file /run/secrets/pw
```

`--chain` is **required** in non-interactive mode. Required credentials must be provided via environment variables (e.g., `JUPITER_API_KEY` for Solana — there is no env var fallback for Sui or Ethereum since they have no required credentials by default). Output is JSON: `{"address":"0x…","chain":"sui:mainnet","derivationPath":"…"}`. With `--generate`, the JSON also includes the mnemonic.

After setup, the user should unlock their wallet for the session:

```bash
fence unlock          # default 4h session
fence unlock --ttl 8h # longer session
```

Valid TTL values: `1h`, `2h`, `4h`, `8h`, `12h`, `24h`. Unlock decrypts every chain key in the keystore at once — there is no per-chain unlock.

## Session Management

The wallet must be unlocked before signing transactions (swaps, lending, perp orders). Read-only commands (query, config show, wallet list, stats, lend markets/portfolio, perp markets/positions/account) work without unlocking.

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

All pipeline-based commands (swap, lending, perp transactional ops) return a unified `CliOutput` JSON structure. Action-specific data is nested in the `payload` field.

```typescript
interface CliOutput<T> {
  status: PipelineStatus;    // "success" | "acknowledged" | "simulated" | "rejected" | "simulation_failed" | "error"
  action: ActivityAction;    // e.g., "trade:swap", "lending:supply"
  chainId: ChainId;          // e.g., "sui:mainnet", "solana:mainnet", "ethereum:mainnet"
  address: string;           // wallet address that executed the action
  gasUsed?: number;          // gas consumed (chain-specific units)
  txDigest?: string;         // on-chain transaction hash / signature
  protocol?: string;         // e.g., "alphalend", "jupiter_lend", "aave_v3", "paraswap"
  payload?: T;               // action-specific data (see below)
  error?: string;            // human-readable error (status: "error")
  rejectionCheck?: string;   // which policy check failed (status: "rejected")
  rejectionReason?: string;  // why the check failed (status: "rejected")
}
```

**Always use `--output json`** (or rely on the default for most pipeline commands) to get machine-parseable results.

## Core Commands

### Swap Tokens

```bash
fence swap <fromToken> <toToken> <amount> [options]
```

| Argument | Description |
|----------|-------------|
| `fromToken` | Source token symbol (e.g., `SUI`, `SOL`, `ETH`) or full address |
| `toToken` | Destination token symbol (e.g., `USDC`) or full address |
| `amount` | Amount in human-readable format (e.g., `10`, `0.5`) |

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --slippage <percent>` | `0.5` | Slippage tolerance in percent |
| `-c, --chain <chain>` | resolved from config | Target chain (`sui`, `solana`, or `ethereum`) |
| `-o, --output <format>` | `json` | Output format (only `json` supported) |

The aggregator is selected automatically by chain (7K on Sui, Jupiter on Solana, Paraswap on Ethereum).

#### Success response

```json
{
  "status": "success",
  "action": "trade:swap",
  "chainId": "ethereum:mainnet",
  "address": "0x7a3f...e821",
  "gasUsed": 210000,
  "txDigest": "0x8Hk4...mW2p",
  "payload": {
    "fromToken": "0x0000...0000",
    "toToken": "0xA0b8...eB48",
    "amountIn": 0.1,
    "amountOut": 320.41,
    "valueUsd": 320.41
  }
}
```

The `payload.amountIn` and `payload.amountOut` are **human-readable numbers** (e.g., `0.1` means 0.1 ETH).

#### Policy rejection response (exit code 3)

```json
{
  "status": "rejected",
  "action": "trade:swap",
  "chainId": "sui:mainnet",
  "address": "0x7a3f...e821",
  "rejectionCheck": "token_allowlist_sui",
  "rejectionReason": "token_not_allowed"
}
```

Possible `rejectionCheck` values: `token_allowlist_sui`, `token_allowlist_solana`, `token_allowlist_ethereum`, `spending_limit`
Possible `rejectionReason` values:
- `token_not_allowed` — token not in the configured allowlist for that chain
- `exceeds_single_trade_limit` — single trade exceeds `max_single_trade`
- `exceeds_24h_volume` — rolling 24h total would exceed `max_24h_volume`

#### Simulated response (watch-only wallet, exit code 0)

Returned when the active wallet for the chain is watch-only — same shape as success, but no transaction is submitted.

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

### Lending

OnlyFence supports lending across three chains. The protocol is auto-resolved from the chain (AlphaLend on Sui, Jupiter Lend on Solana, Aave V3 on Ethereum). Policy checks (token allowlist + spending limits) apply to `supply` operations.

```bash
fence lend supply <token> <amount> [options]    # supply tokens as collateral
fence lend borrow <token> <amount> [options]    # borrow against collateral
fence lend withdraw <token> [amount] [options]  # withdraw supplied tokens
fence lend repay <token> <amount> [options]     # repay borrowed tokens
fence lend claim [options]                      # claim accumulated rewards (Sui/AlphaLend only)
fence lend markets [-c <chain>]                 # list lending markets for the chain
fence lend market <token> [-c <chain>]          # detailed market info for a token
fence lend portfolio [-c <chain>]               # show user lending positions
```

| Option | Default | Description |
|--------|---------|-------------|
| `-m, --market <marketId>` | — | Specific market ID (auto-resolved if omitted) |
| `-c, --chain <chain>` | resolved from config | Target chain |
| `-a, --all` | — | Withdraw all (withdraw only) |

**`fence lend claim` is currently Sui-only** — Jupiter Lend and Aave V3 don't expose a separate rewards-claim flow through this CLI.

#### Lending success response

```json
{
  "status": "success",
  "action": "lending:supply",
  "chainId": "solana:mainnet",
  "address": "9xQ…",
  "gasUsed": 5000,
  "txDigest": "5J…",
  "protocol": "jupiter_lend",
  "payload": {
    "token": "EPjFWdd5...USDC",
    "amount": 100,
    "marketId": "...",
    "valueUsd": 100.0
  }
}
```

Lending responses follow the same unified output pattern as swaps: `success`, `simulated`, `rejected`, `simulation_failed`, or `error`. Borrow, withdraw, repay, and claim are not subject to spending limits.

#### Claim rewards response (Sui only)

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
| `-c, --chain <chain>` | resolved from config | Target chain |
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

EVM balance queries cover native ETH plus the registered ERC-20 tokens (ETH/WETH/USDC/USDT/DAI/WBTC). Solana queries return native SOL plus all SPL token accounts owned by the wallet. Sui queries the full coin balance set.

### Query Price

```bash
fence query price <tokens...> [-c <chain>] [-o <format>]
```

Pass one or more token symbols separated by spaces. Prices are resolved per chain (LP Pro for Sui, Jupiter for Solana, DeFi Llama for Ethereum):

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
fence wallet list [-o json]                          # list all wallets across all chains
fence wallet watch <address> [-c <chain>] [-a <alias>]  # add watch-only wallet
fence wallet switch <alias>                          # set primary wallet for its chain
fence wallet rename <old> <new>                      # rename a wallet
fence wallet import-key [-a <alias>] [-c <chain>]    # import wallet from private key (interactive)
```

Watch-only wallets can simulate swaps and lending but cannot sign real transactions. `import-key` is interactive — it prompts for the private key securely. The chain defaults to the configured default chain if `-c` is omitted.

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

Keys use dot-notation. **Each chain has its own config block** under `chain.<chain_name>` — settings are not shared across chains. The important safety settings:

| Key | Type | Default (per-chain) | Ceiling | Description |
|-----|------|---------------------|---------|-------------|
| `default_chain` | string | first configured chain | — | Chain used when `-c` is omitted (`sui`, `solana`, or `ethereum`) |
| `chain.<chain>.rpc` | string | chain default | — | RPC endpoint for the chain |
| `chain.<chain>.network` | string | `mainnet` | — | Network identifier |
| `chain.<chain>.credentials.<name>` | string | — | — | Per-chain API key (e.g., `jupiter_api_key`) |
| `chain.<chain>.allowlist.tokens` | string[] | varies (see below) | — | Only these tokens can be traded on this chain |
| `chain.<chain>.limits.max_single_trade` | number | varies | `10000` | Max USD value per trade |
| `chain.<chain>.limits.max_24h_volume` | number | varies | `100000` | Max USD rolling 24h total |
| `chain.<chain>.perp.allowlist_markets` | string[] | varies | — | Permitted perp markets for the chain |
| `chain.<chain>.perp.max_leverage` | number | varies | `100` | Max leverage on perp orders |
| `chain.<chain>.perp.max_single_order` | number | varies | `100000` | Max USD value per perp order |
| `chain.<chain>.perp.max_24h_volume` | number | varies | `1000000` | Max USD perp volume / 24h |
| `chain.<chain>.perp.max_24h_withdraw` | number | varies | `100000` | Max USD perp withdraw / 24h |
| `update.auto_install` | boolean | `true` | — | Auto-install updates on check |
| `telemetry.enabled` | boolean | prompted | — | Enable error reporting |
| `security.max_*_ceiling` | number | hardcoded | — | Operator-set upper bounds for the limits above |

**Default per-chain values:**

| Chain | Allowlist tokens | `max_single_trade` | `max_24h_volume` | Perp markets | Perp `max_leverage` |
|-------|------------------|--------------------|--------------------|--------------|----------------------|
| `sui` | SUI, USDC, USDT, DEEP, BLUE, WAL | $200 | $500 | (none configured by default) | — |
| `solana` | SOL, USDC, USDT, JitoSOL, JupSOL | $200 | $500 | SOL-USD, ETH-USD, BTC-USD | 10x |
| `ethereum` | ETH, WETH, USDC, USDT, DAI, WBTC | $500 | $2000 | ETH-USD, BTC-USD, SOL-USD | 5x |

Examples:

```bash
# Raise daily limit to $1000 on Sui
fence config set chain.sui.limits.max_24h_volume 1000

# Add CETUS to Sui's allowlist
fence config set chain.sui.allowlist.tokens '["SUI","USDC","USDT","DEEP","BLUE","WAL","CETUS"]'

# Set Solana as the default chain
fence config set default_chain solana

# View just the Ethereum limits
fence config show chain.ethereum.limits

# Disable automatic updates
fence config set update.auto_install false
```

When setting array values, pass the full array as a JSON string — there is no "append" operation. Ceiling values are hard upper bounds enforced at validation time and cannot be exceeded via plain config (only by raising the corresponding `security.*_ceiling`).

### Query Activities

Flexible querying of all DeFi activity history (trades, lending, LP, perp, staking) with filtering, aggregation, sorting, and grouping. Activity is stored across all chains in a single table — pass `-c <chain>` to scope to one chain.

```bash
fence query activities [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-c, --chain <chain>` | resolved from config | Auto-filter on this chain (`chain_id` filter) |
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

**Key columns:** `category` (trade/lending/lp/perp/staking), `action` (trade:swap, lending:supply, ...), `protocol`, `value_usd`, `gas_cost`, `policy_decision` (approved/rejected), `token_a_symbol`, `token_b_symbol`, `chain_id`, `created_at`. Use `--no-resolve-tokens` when you only need aggregations — symbol columns require the join.

**JSON output:** `{ columns: [...], rows: [...], totalCount: number }`. `totalCount` is the full count, not capped by limit.

**Gotchas:**
- **Timestamps are space-separated** (`2026-03-23 00:00:00`), not ISO `T`-format. Always use `YYYY-MM-DD HH:MM:SS` in date filters.
- **`action` is always `category:action` format** (e.g., `trade:swap`, `lending:supply`). Filter with `eq=trade:swap`, not bare `swap`.
- **`-c` injects a `chain_id` filter** matching the chain's CAIP-2 ID. To query across chains, run separate queries per chain.

#### Examples

```bash
# Recent swaps on the default chain
fence query activities -f action=eq=trade:swap --order-by created_at=desc -l 20 -o json

# Volume by category (default chain)
fence query activities -s category,COUNT\(*\),SUM\(value_usd\) -g category --no-resolve-tokens -o json

# Yesterday's volume on Solana
fence query activities -c solana \
  -f 'created_at=gte=2026-04-16 00:00:00' \
  -f 'created_at=lt=2026-04-17 00:00:00' \
  -s 'COUNT(*),SUM(value_usd)' --no-resolve-tokens -o json

# Rejected activities
fence query activities -s action,rejection_reason,value_usd -f policy_decision=eq=rejected -o json

# Lending activity on Ethereum
fence query activities -c ethereum -f category=eq=lending --order-by created_at=desc -l 20 -o json
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
# 2. Get current prices for tokens involved (per chain)
fence query price SUI WAL USDC -o json
# 3. Calculate: current_value = (amount / 10^decimals) * current_price, PnL = current_value - value_usd
```

**Cross-chain portfolio overview:** Loop balance + prices + lending positions per configured chain.

```bash
# For each chain configured in `fence config show chain`:
fence query balance -c sui -o json
fence query balance -c solana -o json
fence query balance -c ethereum -o json
fence lend portfolio -c sui -o json
fence lend portfolio -c solana -o json
fence lend portfolio -c ethereum -o json
fence query price SUI USDC SOL ETH WBTC -o json   # symbols are scoped to the active chain when calling
# Sum: value = (amount / 10^decimals) * price
```

### Usage Statistics

```bash
fence stats [-d <days>] [-o json]
```

Shows command usage, success rates, and average durations over the last N days (default 30). Stats are cross-chain.

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
| `0` | Success, simulated, or acknowledged |
| `1` | General error |
| `3` | Policy rejection (swap/lending/perp) |
| `4` | Simulation failed (swap/lending only) |

Check the exit code to distinguish between errors and policy rejections — both return JSON but mean different things.

## How to Handle Responses

1. **Parse the `status` field first.** It is always present: `success`, `acknowledged`, `simulated`, `rejected`, `simulation_failed`, or `error`.
2. **On `rejected`**: read `rejectionCheck` and `rejectionReason` to understand why. Common fixes:
   - `token_not_allowed` → the token isn't in the allowlist *for that chain*. Ask the user if they want to add it via `fence config set chain.<chain>.allowlist.tokens '[...]'`.
   - `exceeds_single_trade_limit` → reduce the trade amount, or ask the user to raise `chain.<chain>.limits.max_single_trade`.
   - `exceeds_24h_volume` → the daily cap is reached. Show the user the current limit and ask if they want to raise it or wait.
3. **On `error`**: read `error`. Common causes: wallet not set up for that chain, wallet locked, missing chain credentials (e.g., `JUPITER_API_KEY`), network issues. Guide the user through the fix.
4. **On `simulation_failed`**: the transaction simulation failed on-chain (e.g., insufficient balance, invalid parameters). Read `error` for details.
5. **On `simulated`**: the active wallet for that chain is watch-only. The numbers are estimates. No real transaction was submitted.
6. **On `acknowledged`** (perp only): the order was submitted but the WS confirmation timed out. Verify with `fence perp orders` or `fence perp order-status <hash>`.
7. **On `success`**: read `payload` for action-specific data, `txDigest` for the on-chain transaction hash, and `gasUsed` for gas consumed.

## Supported Actions

| Category | Actions | Status |
|----------|---------|--------|
| Trade | `trade:swap` | Live (Sui, Solana, Ethereum) |
| Lending | `lending:supply`, `lending:borrow`, `lending:withdraw`, `lending:repay` | Live (Sui, Solana, Ethereum) |
| Lending rewards | `lending:claim_rewards` | Live (Sui only) |
| Perps (place/cancel/close) | `perp:place_order`, `perp:cancel_order` | Live (Sui, Solana, Ethereum) |
| Perp margin | `perp:deposit`, `perp:withdraw` | Live (Sui only — Solana/Ethereum bundle margin with positions) |
| LP | `lp:deposit`, `lp:withdraw` | Planned |
| Staking | `staking:stake`, `staking:unstake` | Planned |

## Workflow Patterns

### First-time user (single chain)

```bash
fence setup                              # interactive — chain selection happens here
fence unlock                             # unlock wallet for session
fence query balance -o json              # check what they have
fence query price SUI USDC -o json       # check current prices
fence swap SUI USDC 10                   # execute a trade on the default chain
```

### Adding a second chain

```bash
fence setup                              # re-run wizard, pick a different chain
                                          # wizard merges into existing keystore (asks for password)
fence config set default_chain solana    # optional: change the default
fence query balance -c solana            # confirm
```

### Daily trading session

```bash
fence unlock --ttl 8h                    # one unlock covers all chains
fence query balance -c sui -o json
fence query balance -c ethereum -o json
fence stats -o json                      # review recent activity
# ... execute swaps as needed ...
fence lock                               # end session when done
```

### Lending workflow (any chain)

```bash
fence lend markets -c ethereum           # see available Aave V3 markets
fence lend market USDC -c ethereum       # check USDC market rates
fence lend supply USDC 100 -c ethereum   # supply 100 USDC as collateral
fence lend borrow DAI 50 -c ethereum     # borrow 50 DAI
fence lend portfolio -c ethereum         # check positions
fence lend repay DAI 50 -c ethereum      # repay loan
fence lend withdraw USDC --all -c ethereum  # withdraw all collateral
fence lend claim -c sui                  # claim rewards (Sui-only)
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
fence config show chain.sui.limits       # see current limits for Sui
fence config set chain.sui.limits.max_24h_volume 1000
fence config show chain.solana.allowlist.tokens
fence config set chain.solana.allowlist.tokens '["SOL","USDC","USDT","JitoSOL","JupSOL","BONK"]'

# If daemon is running, changes are NOT active until:
fence restart                            # review diff and restart with password
```

## Perpetual Futures (`fence perp`)

Trade perpetual futures across three protocols. Requires wallet unlock for transactional commands. The default backend is **Bluefin Pro on Sui**; pass `--protocol <name>` to switch:

| Protocol | Chain | Notes |
|----------|-------|-------|
| `bluefin_pro` (default) | Sui | Has separate `perp deposit` / `perp withdraw` for the margin bank |
| `jupiter_perps` | Solana | No margin bank — collateral handled inline with positions |
| `hyperliquid` | Ethereum | Off-chain order book; orders signed by your EVM wallet |

All amounts are human-readable. All numeric values from the providers use **e9 format** (divide by 10^9 for human values):
- **Sizes/prices/PnL:** `sizeE9 = 1000000000` → 1.0 (unit)
- **Leverage:** `leverageE9 = 20000000000` → 20x
- **Fees (ratios, not percentages):** `takerFeeE9 = 1000000` → 1000000 / 10^9 = 0.001 = **0.1%**. Always multiply by 100 to get percent.

Most perp commands accept `--protocol <protocol>` (default `bluefin_pro`). When a perp command targets a different chain, you usually need both `--chain` and `--protocol`.

### Available Markets

```bash
fence perp markets                                # Bluefin Pro markets (default)
fence perp markets --protocol jupiter_perps       # Jupiter Perps markets
fence perp markets --protocol hyperliquid         # Hyperliquid markets
```

Returns: `symbol`, `baseAsset`, `status`, `defaultLeverageE9`, `maxLeverageE9`, `minOrderSizeE9`, `makerFeeE9`, `takerFeeE9`, `makerFeePercent`, `takerFeePercent`.

### Place Orders

```bash
# Market order on Bluefin Pro (Sui — default)
fence perp order SUI-PERP long 1 --type market

# Limit order on Hyperliquid (Ethereum)
fence perp order ETH-USD short 0.1 --type limit --price 3500 \
  --chain ethereum --protocol hyperliquid

# Limit order on Jupiter Perps (Solana) with options
fence perp order SOL-USD long 5 --type limit --price 150 --leverage 10 \
  --tif IOC --reduce-only --chain solana --protocol jupiter_perps
```

| Arg/Option | Required | Default | Description |
|------------|----------|---------|-------------|
| `<market>` | yes | — | Market symbol (e.g., `SUI-PERP`, `ETH-USD`, `BTC-USD`) — exact format depends on protocol |
| `<side>` | yes | — | `long` or `short` |
| `<qty>` | yes | — | Quantity in base asset (e.g., `1` = 1 SUI / 1 ETH / 1 SOL) |
| `-t, --type` | no | `market` | `market` or `limit` |
| `-p, --price` | limit only | — | Limit price in USD |
| `-l, --leverage` | no | auto | Auto-resolved from existing position, else market default |
| `-r, --reduce-only` | no | false | Only reduce existing position |
| `--tif` | no | `GTT` | `GTT` (Good Til Time), `IOC`, `FOK` — limit orders only |
| `-c, --chain` | no | resolved from config | Target chain |
| `--protocol` | no | `bluefin_pro` | Perp protocol to use |

**Response status values:**
- `success` — order confirmed (limit: on the book; market: filled)
- `acknowledged` — order submitted but WS confirmation timed out. Verify with `fence perp orders`
- `error` — rejected with reason (e.g., `INSUFFICIENT_MARGIN`, `INVALID_LEVERAGE`, `REDUCE_ONLY_WOULD_OPEN`)

**Key behaviors:**
- Leverage auto-resolves from your existing position in cross-margin mode. If no position, uses market default. Explicit `--leverage` validates against market max and the configured `chain.<chain>.perp.max_leverage` cap.
- Market orders are sent as `LIMIT + IOC` with aggressive price bounds internally.
- `IOC`/`FOK` limit orders that find no counterparty return `success` (not error) — this is expected.

### Cancel Orders

```bash
fence perp cancel SUI-PERP                            # cancel all orders for market (Bluefin)
fence perp cancel ETH-USD --order <hash> \
  --chain ethereum --protocol hyperliquid             # cancel specific order
fence perp cancel SUI-PERP -o <h1> -o <h2>            # cancel multiple by hash
```

### Close Position

```bash
fence perp close SUI-PERP                              # close full position at market
fence perp close SOL-USD --size 0.5 \
  --chain solana --protocol jupiter_perps              # partial close
```

Auto-detects position side and places a reduce-only market order in the opposite direction. Errors if no position exists for that market on that protocol.

### Deposit / Withdraw Margin (Sui / Bluefin Pro only)

```bash
fence perp deposit 10                          # deposit 10 USDC to Bluefin margin bank
fence perp withdraw 5                          # withdraw 5 USDC from Bluefin margin bank
```

Jupiter Perps and Hyperliquid don't expose a separate `perp deposit` / `perp withdraw` — collateral is bundled with each order. Trying these commands with `--protocol jupiter_perps` or `--protocol hyperliquid` will error.

### Query Commands

```bash
fence perp positions                           # open positions (live from exchange)
fence perp orders                              # open orders
fence perp orders --market SUI-PERP            # filter by market
fence perp order-status <orderHash>            # check specific order status
fence perp account                             # full account: balance, margin, PnL, positions
fence perp funding-rate SUI-PERP               # exchange funding rate history
fence perp funding-rate BTC-USD --limit 5 --protocol hyperliquid
fence perp funding-history                     # your funding payments
fence perp funding-history --limit 10 --protocol jupiter_perps
fence perp sync                                # sync filled trades to local DB
```

All query subcommands accept `--protocol <protocol>` (default `bluefin_pro`).

**`positions` response fields:** `symbol`, `side`, `sizeE9`, `avgEntryPriceE9`, `liquidationPriceE9`, `unrealizedPnlE9`, `leverageE9`, `isIsolated`

**`account` response fields:** `marginBalanceE9`, `freeMarginE9`, `accountValueE9`, `unrealizedPnlE9`, `positions[]`

**`funding-rate` response:** Array of `{ symbol, fundingRateE9, fundingIntervalHours, fundingRateApr, fundingTimeAtMillis }`. `fundingIntervalHours` is per-entry (protocol may change interval over time).

**`funding-history` response:** Array of `{ symbol, paymentAmountE9, rateE9, positionSide, executedAtMillis }`

### Perp Workflow Patterns

**Open a leveraged long on Sui (Bluefin):**
```bash
fence perp deposit 100                                      # fund Bluefin margin
fence perp order SUI-PERP long 50 --type limit --price 3.5  # place order
fence perp orders --market SUI-PERP                         # verify
```

**Open a position on Hyperliquid (Ethereum):**
```bash
# No deposit step — Hyperliquid handles collateral via the EVM signer
fence perp order ETH-USD long 0.5 --type limit --price 3400 \
  --chain ethereum --protocol hyperliquid
fence perp positions --protocol hyperliquid
```

**Close a position:**
```bash
fence perp positions --protocol jupiter_perps               # check current positions
fence perp close SOL-USD --chain solana --protocol jupiter_perps
fence perp positions --protocol jupiter_perps               # verify closed
```

**Monitor:**
```bash
fence perp account --protocol hyperliquid                   # margin, PnL overview
fence perp funding-history --protocol jupiter_perps         # funding payments
fence perp sync --protocol bluefin_pro                      # sync fills to local DB for analytics
```

## Important Notes

- **Multi-chain is first-class.** Every command takes `-c <chain>`; when omitted it falls back to `config.default_chain`, then to the first configured chain. Don't assume Sui — read the user's config or pass `-c` explicitly.
- **Each chain has independent guardrails.** Allowlists, spending limits, and perp limits are configured under `chain.<chain>.*` and never cross over. A token allowed on Sui is not automatically allowed on Solana or Ethereum.
- **Solana requires `JUPITER_API_KEY`.** Setup will prompt for it; in non-interactive mode the env var must be set. Sui and Ethereum have no required credentials by default.
- **Swap and lending output amounts are human-readable** — `payload.amountIn: 10` means 10 tokens, not 10 base-units. No conversion needed when displaying to the user.
- **Balance query amounts are in smallest units** — `"amount": "1000000000"` with `"decimals": 9` means 1.0 SUI (or 1.0 SOL — both are 9 decimals). Divide by `10^decimals` for display.
- **Perp e9 format** — divide by 10^9 for human values. **Fee e9 values are ratios** — multiply by 100 after dividing to get percent (e.g., `1000000 / 1e9 = 0.001 = 0.1%`).
- **`fence setup`, `fence unlock`, and `fence wallet import-key` are interactive** — they prompt for passwords or keys. Never try to pipe passwords or automate these (except non-interactive setup with `--password-file`). Tell the user to run them.
- **All guardrail checks happen automatically** on every swap, lending supply, and perp action. Token-allowlist checks are scoped per chain (`token_allowlist_sui`, `token_allowlist_solana`, `token_allowlist_ethereum`). You do not need to manually check policy.
- **USD price oracle can fail.** When it does, token allowlist checks still apply but USD-based spending limits are skipped (logged, not silently bypassed).
- **Perp orders use WebSocket / API confirmation** — the CLI waits for exchange confirmation before returning. If it times out, status is `acknowledged` (not `success`).
- **SDK logs go to stderr** — stdout is always clean JSON. Parse stdout only.
- **Config changes require user action in daemon mode** — `fence config set` only writes to the file on disk. The daemon does NOT auto-reload. The user must run `fence restart` to review the diff and apply changes with their password. Never claim a config change is active without this step.
- **Config ceilings exist** — defaults are `max_single_trade ≤ $10,000`, `max_24h_volume ≤ $100,000`, `max_perp_leverage ≤ 100`, `max_perp_single_order ≤ $100,000`, `max_perp_24h_volume ≤ $1,000,000`, `max_perp_24h_withdraw ≤ $100,000`. Operators can raise them via `security.*_ceiling`.
- **`lend claim` is Sui-only.** Don't recommend it on Solana or Ethereum.
- **`perp deposit` / `perp withdraw` are Sui-only** (Bluefin Pro). Solana and Ethereum perps bundle collateral inline.
- **The `--verbose` global flag** enables debug logging to stderr. Useful for troubleshooting but noisy — only use when diagnosing issues.
