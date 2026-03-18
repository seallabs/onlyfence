# OnlyFence — Deployment Strategy: Balancing Security & UX

**Version 1.0 | March 2026**
**Audience: Engineering Team**
**Dependencies: Signer Daemon Spec v2.1, Setup Spec v1.0, CLI Interaction Model, Red Team Analysis**

---

## 1. Philosophy

> **Ship what's easy first. Let users graduate when they're ready.**

OnlyFence follows the OpenClaw model: a dummy user installs it on their machine to experiment. If they care about security but lack technical depth, they run a daemon process. If they want maximum isolation, they use Docker. We never force users into a tier — we make the secure path easy and the easy path visible.

**Design axioms:**

1. **UX first, then security.** A tool nobody installs protects nobody.
2. **Tiers are emergent, not configured.** There is no `mode = "daemon"` in config. The CLI auto-detects whether a daemon is reachable and behaves accordingly.
3. **Same data, different runtime.** All tiers share `~/.onlyfence/` (keystore, config.toml, trades.db). Switching tiers requires zero migration.
4. **Warn, don't block.** Security warnings are prominent but never prevent the user from running the product.
5. **One command to start.** Regardless of tier, the user goes from zero to a working setup with minimal interaction.

---

## 2. Deployment Tiers

### 2.1 Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Tier 0: Experimental        Tier 1: Daemon         Tier 2: Docker     │
│  ─────────────────────       ──────────────          ──────────────     │
│  fence swap runs             fence start runs        Docker container   │
│  in-process.                 a daemon. fence swap    isolates daemon    │
│  Everything on disk.         becomes thin client.    in its own         │
│  Zero friction.              Better security.        namespace.         │
│                                                      Maximum security.  │
│  Target: experimenting       Target: production      Target: servers,   │
│  learning, dev               single-machine          shared machines    │
│                                                                         │
│  Security:  ★☆☆              Security:  ★★☆          Security:  ★★★    │
│  UX:        ★★★              UX:        ★★★          UX:        ★★☆    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 What Differs by Tier

| Aspect | Tier 0 (Experimental) | Tier 1 (Daemon) | Tier 2 (Docker) |
|--------|----------------------|-----------------|-----------------|
| Install | `curl \| sh` → choose [1] | `curl \| sh` → choose [2] | `curl \| sh` → choose [3] (handles Docker setup) |
| Key storage | Encrypted keystore on disk | In daemon memory only | In container memory only |
| Policy engine | Runs in `fence swap` process | Runs inside daemon | Runs inside container |
| Config changes | Edit file, instant effect | `fence config set --reload` (password required) | `docker exec fence config set --reload` (auto-password) |
| Trade history | SQLite on disk (writable) | Daemon holds exclusive DB lock + in-memory | Container filesystem isolation |
| Agent can tamper config? | **Yes** | No (daemon uses startup snapshot until password-authenticated reload) | No (different filesystem namespace) |
| Agent can wipe trade history? | **Yes** | No (exclusive DB lock + in-memory history) | No (different filesystem namespace) |
| Agent can read private key? | Encrypted, but attackable | `PR_SET_DUMPABLE=0` + daemon memory only | PID namespace isolation |
| Agent can kill the process? | Yes (DoS only) | Yes (DoS only, key dies, can't restart without password) | No (different PID namespace) |
| Password needed to start? | Every `fence swap` (or cached) | Once at daemon startup | From Docker secret file |

### 2.3 The Auto-Detection Model

The user never specifies which tier they're in. `fence swap` auto-detects:

```
fence swap SUI USDC 100
│
├─ Check --addr flag or FENCE_DAEMON_ADDR env var
│   └─ Set? → Connect to that address (Tier 1/2)
│
├─ Check if ~/.onlyfence/signer.sock exists and is connectable
│   └─ Yes? → Route to daemon via Unix socket (Tier 1)
│
└─ Neither? → Run in-process (Tier 0)
```

This means:
- **Tier 0 users** just run `fence swap` — works immediately, no setup.
- **Tier 1 users** run `fence start`, then `fence swap` — auto-routes to daemon.
- **Tier 2 users** set `FENCE_DAEMON_ADDR=tcp://127.0.0.1:19876` once, then `fence swap` — auto-routes to container.

Same command, three behaviors, zero flags in the common case.

**Critical rule:** If the daemon is running and `fence swap` detects it, it MUST route through the daemon. There is no `--in-process` bypass. This prevents policy bypass when the daemon is supposed to be enforcing rules, and avoids SQLite write contention.

---

## 3. Install & Packaging

### 3.1 Install Script

```bash
# One command. Everything happens inside.
curl -fsSL https://get.onlyfence.dev/install.sh | sh
```

That's it. One command. The script installs the binary, then presents an interactive menu to choose the deployment mode. All prompts read from `/dev/tty` (not stdin), so `curl | sh` piping works correctly.

**For automation/CI**, the env var `FENCE_TIER` skips the interactive menu:

```bash
curl -fsSL https://get.onlyfence.dev/install.sh | FENCE_TIER=daemon sh
curl -fsSL https://get.onlyfence.dev/install.sh | FENCE_TIER=docker sh
curl -fsSL https://get.onlyfence.dev/install.sh | FENCE_TIER=standalone sh
```

#### The Interactive Setup Flow

After installing the binary, `install.sh` presents this menu (reading from `/dev/tty`):

```
  OnlyFence Installer
  ──────────────────────────────────────────────

  ✓ Node.js v22.1.0 detected
  ✓ Installed from GitHub release v0.1.0
  ✓ fence added to PATH

  How would you like to deploy OnlyFence?

    [1]  Standalone (experimental)
         Easiest setup. Everything runs locally.
         Best for: trying it out, learning, dev.

    [2]  Daemon (recommended for agents)
         Background process holds keys and enforces policy.
         Best for: running AI agents on this machine.

    [3]  Docker (maximum security)
         Daemon runs in a container, fully isolated.
         Best for: servers, shared machines, production.

  Choose [1/2/3]: _
```

Single keypress. No ambiguity. What happens next depends on the choice:

#### Choice 1: Standalone (Experimental)

The simplest path. Runs `fence quickstart` in standalone mode:

```
  ── Wallet Setup ────────────────────────────

  [g] Generate new wallet
  [i] Import existing mnemonic

  Choice: g

  Generating Sui wallet...

  ⚠ BACK UP THIS MNEMONIC — you will NOT see it again:

    abandon ability able about above absent absorb abstract ...

  Address: 0xabc123...def

  Enter password: ********
  Confirm password: ********

  ✓ Keystore encrypted
  ✓ Config initialized (defaults)

  ── Ready ────────────────────────────────────

  OnlyFence is set up in standalone mode.

  Try it:
    fence swap SUI USDC 100 --output json

  Manage:
    fence status       # check status
    fence config set   # customize policy
    fence tui          # interactive dashboard

  ⚠ Standalone mode stores keys on disk.
    For better security, upgrade anytime:  fence start
```

#### Choice 2: Daemon

Same wallet setup as above, but ends with daemon auto-start:

```
  ... (same wallet + password flow as above) ...

  ── Starting Daemon ──────────────────────────

  ✓ Daemon started (PID 48291)
  ✓ Listening on ~/.onlyfence/signer.sock

  Your agent can now run:
    fence swap SUI USDC 100 --output json

  Manage:
    fence status       # check daemon health
    fence stop         # stop daemon
    fence config set   # customize policy (requires password)
```

Terminal returned. Daemon running in background.

#### Choice 3: Docker

The install script handles everything — the user never needs to download compose files, create password files, or switch terminal tabs:

```
  ── Docker Setup ─────────────────────────────

  ✓ Docker detected (Docker Desktop 4.35.1)
  ✓ Docker Compose detected

  Enter a password for the keystore: ********
  Confirm password: ********

  Where to store Docker files? [~/.onlyfence/docker]: _

  ✓ Generated docker-compose.yml
  ✓ Created password file (chmod 0600)
  ✓ Pulling image ghcr.io/seallabs/onlyfence:latest...
  ✓ Container started

  ── Wallet ───────────────────────────────────

  ⚠ BACK UP THIS MNEMONIC — you will NOT see it again:

    abandon ability able about above absent absorb abstract ...

  Address: 0xabc123...def

  ── Ready ────────────────────────────────────

  OnlyFence is running in Docker (maximum security).

  Your agent needs this env var:
    export FENCE_DAEMON_ADDR="tcp://127.0.0.1:19876"

  Then:
    fence swap SUI USDC 100 --output json

  Manage:
    fence status                    # check daemon health
    docker compose -f ~/.onlyfence/docker/docker-compose.yml logs
    docker compose -f ~/.onlyfence/docker/docker-compose.yml restart
```

**How Docker setup works internally:**

1. Check Docker and Docker Compose are installed. If not: suggest installing Docker, offer to fall back to Daemon mode.
2. Prompt password via `/dev/tty` (echo disabled).
3. Write `~/.onlyfence/docker/docker-compose.yml` (generated, not downloaded — no network dependency after binary install).
4. Write `~/.onlyfence/docker/.fence_password` with `chmod 0600`.
5. Run `docker compose -f ~/.onlyfence/docker/docker-compose.yml up -d`.
6. Wait for container to be healthy (poll `docker compose logs` for "Listening on" line, timeout 30s).
7. Extract mnemonic from container first-boot logs and display it to the user.
8. Print the `FENCE_DAEMON_ADDR` env var they need to set.
9. Optionally append `export FENCE_DAEMON_ADDR=...` to the user's shell profile (ask first).

**If Docker is not installed:** The script detects this and offers a graceful fallback:

```
  Docker not found on this machine.

  [1] Install Docker first, then re-run this installer
      → https://docs.docker.com/get-docker/

  [2] Use Daemon mode instead (good security, no Docker needed)

  [3] Use Standalone mode (easiest, less secure)

  Choose [1/2/3]: _
```

**The key UX principle: the user never leaves the install script.** No "now open another tab and run these 3 commands." Everything happens in one flow, one terminal, one session.

### 3.2 Packaging Formats

| Format | Use case | Platforms |
|--------|----------|-----------|
| **GitHub Release tarballs** (primary) | Fast install, no npm needed, pre-built native addons | macOS arm64/x64, Linux x64/arm64 |
| **npm registry** (fallback) | `npm install -g onlyfence` or `npx onlyfence` | All Node.js platforms |
| **Docker image on GHCR** (Tier 2) | `ghcr.io/seallabs/onlyfence:latest` | linux/amd64, linux/arm64 |

**No Windows native support.** WSL2 is the recommended path. Unix sockets and `better-sqlite3` native addon make Windows support disproportionately expensive.

**Native addon (`undumpable.c` / `PT_DENY_ATTACH`) is optional.** If compilation fails at install time, the daemon logs a warning and runs without it. Never a hard dependency.

### 3.3 First-Run Experience

**Detection:** First run is detected by the absence of `~/.onlyfence/keystore`. This is the definitive marker.

**Path A — Install script (recommended).** All three tiers are set up in one flow inside install.sh. See Section 3.1 for the complete interactive flow. The user runs one command and walks away with a fully working setup, regardless of tier.

```bash
curl -fsSL https://get.onlyfence.dev/install.sh | sh
# → Interactive: choose tier → wallet setup → password → done
# → Everything ready. Zero additional steps.
```

**Path B — Manual install (npm, then TUI).** User installs via `npm install -g onlyfence`, then types `fence`. The TUI launches, detects no keystore, and shows the same tier selection wizard as the install script but in TUI form.

```
$ npm install -g onlyfence
$ fence
→ TUI launches, detects no keystore, shows setup wizard
→ Tier selection → Wallet setup → Password → Config defaults → Done
→ Dashboard appears, user is ready
```

**Path C — Non-TTY first use.** If the user tries `fence swap` without setup:

```
$ fence swap SUI USDC 100
Error: First-time setup required.
  Run `fence setup` to create a wallet and configure policies.
  Or launch the interactive setup: fence
```

**The key principle: every entry point leads to the same interactive setup flow.** Whether the user arrives via `curl | sh`, `npm install`, or just typing `fence`, they get a guided setup that asks how they want to deploy and handles everything from there.

### 3.4 Tier Upgrades (Zero Migration)

All tiers share `~/.onlyfence/`. Upgrading is just changing how the process runs:

| Upgrade | What to do | Data migration? |
|---------|-----------|-----------------|
| Tier 0 → Tier 1 | `fence start` | None. Daemon reads same files. |
| Tier 1 → Tier 2 | Copy `~/.onlyfence/{keystore,config.toml,trades.db}` to Docker volume | File copy only |
| Any tier → Tier 0 | `fence stop` (or stop container) | None. CLI runs in-process again. |

**When daemon starts, it acquires exclusive SQLite lock.** If a Tier 0 `fence swap` runs while daemon is up, it auto-routes through the daemon (not in-process), avoiding contention.

---

## 4. CLI Interaction

### 4.1 Command Structure

```
fence                          # TTY → TUI, non-TTY → help text
fence setup                    # Interactive wallet setup wizard
fence quickstart               # Setup + daemon start in one flow
fence swap <from> <to> <amt>   # Execute trade (auto-detects tier)
fence start [--detach]         # Start daemon (promotes to Tier 1)
fence stop                     # Stop daemon (back to Tier 0)
fence status                   # Health check, works in all tiers
fence config show [key]        # Display config
fence config set <key> <val>   # Update config value
fence config edit              # Open config.toml in $EDITOR
fence config add <key> <val>   # Append to array field
fence config remove <key> <val># Remove from array field
fence reload                   # Reload config into running daemon
fence query price <tokens>     # Get USD prices
fence query balance            # Check wallet balances
fence tui                      # Launch TUI explicitly
```

### 4.2 Output Format (TTY Auto-Detection)

```
Human on TTY:       fence swap SUI USDC 100      → pretty table
Agent piping:       RESULT=$(fence swap SUI USDC 100)  → JSON (auto)
Force JSON:         fence swap SUI USDC 100 --output json
Force human:        fence swap SUI USDC 100 --output human | less
```

**Rule:** stderr for humans (warnings, banners), stdout for machines (JSON data). This means:
```bash
# Agent captures only JSON
RESULT=$(fence swap SUI USDC 100 2>/dev/null)
# Human sees both
fence swap SUI USDC 100
```

### 4.3 Human Output for Swap

```
$ fence swap SUI USDC 100
Swap executed successfully.

  SUI 100 → USDC 98.12
  Value:     $98.00
  Route:     SUI → USDC via Cetus
  Gas:       0.0021 SUI
  Tx:        8Hk4...mW2p
  Explorer:  https://suiscan.xyz/mainnet/tx/8Hk4...mW2p
```

Rejection includes the fix command:
```
$ fence swap SUI USDC 1000
Trade rejected by policy.

  Check:     spending_limit
  Reason:    Exceeds per-trade limit
  Detail:    Trade value $980 exceeds max_single_trade of $200

  To adjust:  fence config set chain.sui.spending.max_single_trade 1000
```

### 4.4 Config Editing by Tier

| Tier | Primary method | What happens |
|------|---------------|-------------|
| **0 (Experimental)** | `fence config set` or edit file directly | Immediate effect (no daemon to reload) |
| **1 (Daemon)** | `fence config set --reload` | Writes file + sends password-authenticated reload to daemon |
| **1 (Daemon)** | `fence config edit` + `fence reload` | Opens $EDITOR, then reload with password |
| **2 (Docker)** | `docker exec onlyfence fence config set --reload` | Auto-resolves password from `FENCE_PASSWORD_FILE` inside container |
| **Server/SSH** | `ssh myserver fence config set chain.sui.spending.max_single_trade 500` | Works identically |

**Password requirement for reload (Tier 1/2):** The daemon verifies the password via scrypt against the keystore before accepting config changes. This prevents a prompt-injected agent from weakening spending limits. The scrypt check adds ~200ms latency, providing mild brute-force resistance. Rate limiting on the socket further constrains attempts.

### 4.5 Error Messages: Always Actionable

Every error answers: (1) What happened? (2) Why? (3) What to do?

```
$ fence swap SUI USDC 10
Error: Cannot connect to OnlyFence daemon.

  Address:  ~/.onlyfence/signer.sock (from config.toml)
  Reason:   Connection refused — daemon is not running.

  To fix:
    fence start           Start in foreground
    fence start --detach  Start as background service

  If using Docker:
    export FENCE_DAEMON_ADDR="tcp://127.0.0.1:19876"
```

### 4.6 Daemon Address Resolution

Priority order for determining where `fence swap` connects:

1. `--addr` flag (per-command override)
2. `FENCE_DAEMON_ADDR` environment variable
3. `daemon.addr` in `config.toml`
4. Default: `~/.onlyfence/signer.sock` (auto-probe)

```bash
# Docker user: set once in shell profile
export FENCE_DAEMON_ADDR="tcp://127.0.0.1:19876"

# Or set once in config
fence config set daemon.addr "tcp://127.0.0.1:19876"
```

---

## 5. TUI Experience

### 5.1 First-Run Tier Selection Wizard

When a user types `fence` on a TTY with no keystore, the TUI launches the setup wizard. The very first screen is tier selection:

```
╭──────────────────────────────────────────────────────────────╮
│  OnlyFence v0.1.0 — Agent wallet guardrails for DeFi        │
╰──────────────────────────────────────────────────────────────╯

  How would you like to deploy OnlyFence?

  > [1]  Standalone (experimental)
         Easiest setup. Everything runs locally.
         Best for: trying it out, learning, dev.

    [2]  Daemon (recommended for agents)
         Background process holds keys and enforces policy.
         Best for: running AI agents on this machine.

    [3]  Docker (maximum security)
         Daemon runs in a container, fully isolated.
         Best for: servers, shared machines, production.

  ──────────────────────────────────────────────────────
                 Standalone     Daemon          Docker
  Keys held by   disk           daemon memory   container
  Config edit    any process    password + IPC  volume mount
  Agent access   direct CLI     Unix socket     TCP
  ──────────────────────────────────────────────────────

  Choose [1/2/3]:
```

**After selection:**

| Tier | Next steps in wizard |
|------|---------------------|
| 0 | Wallet → Password → Auto-update → Done → Dashboard |
| 1 | Wallet → Password → Auto-update → "Starting daemon..." → Done → Dashboard |
| 2 | Docker instructions screen → Exit TUI (no wallet setup; container handles it) |

### 5.2 Dashboard: Tier-Aware

The dashboard header shows the current mode:

```
Tier 0: Dashboard  --  Chain: sui  --  ⚠ Experimental mode
Tier 1: Dashboard  --  Chain: sui  --  Daemon: running (PID 48291)
Tier 2: Dashboard  --  Chain: sui  --  Container: a1b2c3d4
```

**Tier 0 amber security banner (persistent, all tabs):**

```
  ⚠ Experimental mode — Config and keystore accessible to local processes.
    For production, run: fence start
```

This banner is NOT dismissable. It's ambient awareness, not a nag. Shown once per session would be forgotten; persistent keeps the security posture visible.

### 5.3 Config Editing in TUI

| Tier | TUI behavior |
|------|-------------|
| **0** | Inline editing, saves to config.toml immediately. No password needed. Current behavior, unchanged. |
| **1** | Password prompt once at TUI launch ("Unlock session"). Config edits during session send password-authenticated reload to daemon. Session expires when TUI closes. |
| **2** | Policy tab is **read-only**. Shows current config with message: "Config is read-only in Docker mode. Edit the mounted config.toml and restart." |

### 5.4 Security Status Tab

A dedicated tab showing the security posture:

```
  Security Status
  ──────────────────────────────────────────────

  Deployment:    Tier 1 (Daemon)
  Daemon PID:    48291
  Uptime:        3h 12m
  Config hash:   a1b2c3... (matches daemon snapshot ✓)

  Protections:
    ✓  Keys in daemon memory (not on disk during operation)
    ✓  Config snapshot immutable since daemon start
    ✓  Trade history exclusive lock held
    ✓  PR_SET_DUMPABLE disabled
    ⚠  Installation directory writable by current user

  Recent trades:
    10:32  SUI→USDC  100 SUI  $98.00   ✓ approved
    10:15  SUI→USDT   50 SUI  $49.01   ✓ approved
    09:58  SUI→DEEP  200 SUI  $195.17  ✗ rejected (24h_volume)
```

---

## 6. Security Model by Tier

### 6.1 Tier 0 — Experimental: Accepted Risks and Mitigations

Tier 0 is inherently less secure because everything lives on disk. **This is acceptable for experimentation with small amounts.** The following mitigations make it "good enough":

#### Must-Ship Mitigations (~60 lines of code, zero UX changes)

| # | Mitigation | What it blocks | Lines |
|---|-----------|---------------|-------|
| 1 | **File permissions: 0600 on keystore, config.toml, trades.db** | Casual reads by other users on shared machines | ~5 |
| 2 | **Environment sanitization at process entry** — strip `NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, `NODE_PATH`, `HTTPS_PROXY`, `HTTP_PROXY` | Code injection on process restart, oracle MITM | ~8 |
| 3 | **Config upper bounds validation** — reject `max_single_trade > 10000` (or configurable ceiling) | Agent sets limits to infinity | ~10 |
| 4 | **Oracle fail-closed with 5-minute price cache** — if oracle unreachable AND cache stale, REJECT trades needing USD pricing | **The #1 attack** — agent blocks oracle, gets unlimited trading | ~30 |
| 5 | **One-time security warning during setup** — "Experimental mode, not for large balances" | User awareness | ~5 |
| 6 | **Documented wallet balance recommendation** — "$50 max for experimental use" in setup wizard and docs | User expectations | ~2 |

**Total: ~60 lines. Zero new dependencies. Zero changes to setup workflow. Zero UX friction.**

#### What a Prompt-Injected Agent Would Actually Do (Tier 0)

The most realistic attack — requiring zero sophistication — is:

```bash
# Step 1: Weaken policy
echo 'max_single_trade = 999999999' >> ~/.onlyfence/config.toml

# Step 2: Drain wallet
fence swap SUI USDC 999999 --output json
```

**With mitigations applied:**
- Config validation rejects `999999999` (exceeds upper bound) → mitigation #3
- Even if config is tampered, oracle fail-closed prevents unlimited USD trading → mitigation #4
- File permissions prevent casual tampering by other users → mitigation #1

**What remains possible in Tier 0:**
- Agent can still edit config.toml (same-user file access). Config upper bounds limit the damage.
- Agent can wipe trade history (SQLite DELETE). Partially mitigated by in-memory 24h tracking (daemon mode only).
- Agent can read the encrypted keystore. Without the password, it's AES-256-GCM encrypted. The password is entered interactively and never stored.

**Verdict: Tier 0 is shippable** with the mitigations above. The residual risk is bounded by config upper limits and wallet balance recommendations.

### 6.2 Tier 1 — Daemon: Security Properties

| Attack | Defense | Status |
|--------|---------|--------|
| Config tampering | Daemon uses immutable startup snapshot. Reload requires password. | **Blocked** |
| Trade history wipe | Exclusive SQLite lock + in-memory rolling window | **Blocked** |
| Direct socket bypass | No signing endpoint. Socket only accepts trade intents → full policy pipeline. | **Blocked** |
| Kill + replace daemon | Rogue has no key. Can't restart without password. DoS only. | **Bounded** |
| Memory reading | `PR_SET_DUMPABLE=0` (Linux), `PT_DENY_ATTACH` (macOS) | **Best-effort** |
| Binary replacement | Root-owned install path. Agent is non-root. | **Blocked** |
| NODE_OPTIONS injection | Environment sanitization at daemon entry | **Blocked** |
| Oracle manipulation | Fail-closed with 5-min cache | **Blocked** |
| Password interception (alias/PATH) | User education: always use full path `/usr/local/bin/fence start` | **Documented** |

**Minimum security bar for Tier 1:**
1. All Tier 0 mitigations
2. Daemon running with password-decrypted key in memory only
3. Config snapshot immutable after load
4. Password-authenticated config reload over IPC
5. Rate limiting on socket (30 req/min, 5 concurrent connections)

### 6.3 Tier 2 — Docker: Security Properties

Container namespace isolation eliminates all filesystem and process attacks:

| Attack | Defense |
|--------|---------|
| Config tampering | Different filesystem namespace |
| Trade history wipe | Different filesystem namespace |
| Kill daemon | Different PID namespace |
| Memory reading | Different PID namespace |
| Binary replacement | Different filesystem namespace |
| Socket access | TCP with intent-only protocol (no signing endpoint) |
| Password interception | Password from Docker secret (tmpfs mount inside container) |

**The only attack surface is the TCP socket**, which enforces the full policy pipeline. TCP is bound to `127.0.0.1` via Docker port mapping — not reachable from the network.

**Minimum security bar for Tier 2:**
1. Port mapping to `127.0.0.1` only (refuse non-loopback without `--allow-remote`)
2. `--read-only` container filesystem
3. Docker secret for password (not env var on host)

### 6.4 Residual Risks (All Tiers)

| Risk | Severity | Tier | Mitigation |
|------|----------|------|-----------|
| Root compromise | Out of scope | All | Defeats all local security |
| Agent DoS (kills daemon) | Low | 0/1 | Stops trading, can't steal funds |
| GC copies key before zeroing | Very Low | All | V8 language limitation. Microsecond window. |
| Swap splitting (patient drain over days) | Medium | All | 24h cap limits velocity. Post-MVP: lifetime circuit breaker |
| Pre-startup config poisoning | Low | 1 | Config hash displayed at startup + in `fence status` |
| Running as root | High | 0/1 | Startup warning. Don't block. |

### 6.5 Upgrade Triggers

When should we PUSH users from Tier 0 to Tier 1?

| Signal | Action |
|--------|--------|
| Wallet balance > $100 USD | Show warning in `fence status` and TUI: "Your wallet holds $X. Consider running a daemon for better protection." |
| Agent-mode usage detected (non-TTY + `--output json` patterns) | Show one-time suggestion: "Detected agent usage. For agent isolation, run: `fence start`" |
| Multi-chain setup | Suggest daemon mode in setup flow |
| User explicitly asks for more security | TUI tier selection, or `fence start` |

These are **suggestions only**, never blockers. The user decides.

---

## 7. The Server Story (SSH Workflow)

### 7.1 Initial Setup

```bash
# SSH into VPS
ssh myserver

# Install (Tier 1 for server use)
curl -fsSL https://get.onlyfence.dev/install.sh | FENCE_TIER=daemon sh
# → Interactive wallet setup, password prompt, daemon starts
```

### 7.2 Daily Management

```bash
# Quick health check
ssh myserver fence status

# Change a limit
ssh myserver fence config set chain.sui.spending.max_single_trade 500 --reload
# → Password prompt over SSH (stdin forwarded)

# Monitor recent trades
ssh myserver fence status --output json | jq '.chains.sui.limits.used24h'

# Open TUI over SSH
ssh -t myserver fence tui
```

### 7.3 Config Editing on Server

Three methods, all work over SSH:

| Method | Command | Best for |
|--------|---------|----------|
| Single value | `fence config set chain.sui.spending.max_24h_volume 1000` | Quick changes |
| Full editor | `fence config edit` (opens `$EDITOR`) | Multi-field edits |
| Manual | `vim ~/.onlyfence/config.toml` then `fence reload` | Power users |

### 7.4 Password Recovery

If the user forgot their password:
- The keystore cannot be decrypted. This is by design (AES-256-GCM).
- Recovery path: re-import wallet from mnemonic backup via `fence setup --import`.
- Trade history is preserved (it's in SQLite, not encrypted).

---

## 8. Docker Deployment (Tier 2)

### 8.1 Getting Started

**Recommended: via install script (one command, one flow):**

```bash
curl -fsSL https://get.onlyfence.dev/install.sh | sh
# → Choose [3] Docker
# → Script handles everything: password, compose file, pull, start, mnemonic display
```

The install script generates `docker-compose.yml`, creates the password file, pulls the image, starts the container, waits for first boot, extracts and displays the mnemonic — all in one interactive flow. See Section 3.1 for the full walkthrough.

**Alternative: manual setup (for automation/CI):**

```bash
curl -fsSL https://get.onlyfence.dev/install.sh | FENCE_TIER=docker sh
# Or fully manual:
curl -fsSL https://get.onlyfence.dev/docker-compose.yml -o docker-compose.yml
echo "my-strong-password" > .fence_password && chmod 600 .fence_password
docker compose up -d
docker compose logs onlyfence | head -20  # grab the mnemonic
```

### 8.2 docker-compose.yml

```yaml
services:
  onlyfence:
    image: ghcr.io/seallabs/onlyfence:latest
    ports:
      - "127.0.0.1:19876:19876"   # Loopback only
    volumes:
      - onlyfence-data:/data
    environment:
      - FENCE_PASSWORD_FILE=/run/secrets/fence_password
    secrets:
      - fence_password
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp

volumes:
  onlyfence-data:

secrets:
  fence_password:
    file: ./.fence_password
```

### 8.3 Agent Integration

The agent (e.g., OpenClaw) runs on the host or in a separate container:

```bash
# Host agent
export FENCE_DAEMON_ADDR="tcp://127.0.0.1:19876"
fence swap SUI USDC 100 --output json

# Or in docker-compose.yml alongside the agent:
services:
  agent:
    image: openclaw:latest
    environment:
      - FENCE_DAEMON_ADDR=tcp://onlyfence:19876
    depends_on:
      - onlyfence
```

### 8.4 Config Changes in Docker

```bash
# Update and reload — password auto-resolved from FENCE_PASSWORD_FILE
docker compose exec onlyfence fence config set chain.sui.spending.max_single_trade 500 --reload
✓ Config updated and reloaded.
  spending.max_single_trade: 200 → 500
```

This is secure because `docker compose exec` is a privileged host operation — the agent running outside the container cannot exec into it.

### 8.5 TUI in Docker

```bash
docker exec -it onlyfence fence tui
```

Works because `docker exec -it` allocates a PTY. The Policy tab is read-only in Docker mode.

---

## 9. Implementation Plan

### 9.1 Phase 1: Tier 0 Hardening (Ship First)

These mitigations improve Tier 0 security with zero UX impact. Ship before daemon work.

| Task | Effort | Impact |
|------|--------|--------|
| File permissions 0600 on keystore, config, DB | 0.5d | Prevents cross-user reads |
| Environment sanitization at CLI entry point | 0.5d | Blocks NODE_OPTIONS/LD_PRELOAD injection |
| Oracle fail-closed with 5-min price cache | 1d | **Blocks the #1 attack vector** |
| Config upper bounds validation | 0.5d | Limits damage from config tampering |
| `PR_SET_DUMPABLE=0` + verify + warn | 0.5d | Blocks same-user memory reads |
| `PT_DENY_ATTACH` on macOS | 0.5d | Blocks macOS debugger attachment |
| Refuse non-loopback TCP without `--allow-remote` | 0.5d | Prevents accidental network exposure |
| Remove `policy_checks` from status response | 0.5d | Reduces information leakage |
| Print config summary at daemon startup | 0.5d | Makes config tampering visible |
| Startup warnings (root, permissions, writable install) | 0.5d | User awareness |

**Total Phase 1: ~5.5 engineering days**

### 9.2 Phase 2: Daemon Core (Tier 1)

Per the Signer Daemon Spec v2.1 sprint plan.

| Task | Effort |
|------|--------|
| IPC message types + socket server (Unix + TCP) | 2d |
| Password resolution module + PID management | 1d |
| Config snapshot + in-memory trade history + DB lock | 1.5d |
| Trade executor pipeline (policy → build → sign → submit) | 1.5d |
| `fence start` / `fence stop` / `fence status` commands | 1.5d |
| Gut `fence swap` → thin client with auto-detection | 1d |
| Rate limiting + graceful shutdown | 1d |
| Password-authenticated config reload | 1.5d |

**Total Phase 2: ~11 engineering days**

### 9.3 Phase 3: Install & TUI Polish

| Task | Effort |
|------|--------|
| install.sh `FENCE_TIER` routing | 0.5d |
| `fence quickstart` command (bare metal) | 1.5d |
| `fence quickstart-docker` command (container) | 0.5d |
| TUI tier selection wizard screen | 1d |
| TUI security banner (Tier 0 amber warning) | 0.5d |
| TUI Status tab | 1d |
| TUI session unlock for Tier 1 config editing | 1d |
| TTY auto-detect output format standardization | 1d |
| Actionable error messages with fix commands | 1d |

**Total Phase 3: ~8 engineering days**

### 9.4 Phase 4: Docker & Release Pipeline

| Task | Effort |
|------|--------|
| Dockerfile + docker-entrypoint.sh | 0.5d |
| docker-compose.yml | 0.5d |
| GHCR multi-arch build in release.yml | 0.5d |
| Container integration tests | 1d |
| Adversarial tests (all tiers) | 2d |

**Total Phase 4: ~4.5 engineering days**

### Total: ~29 engineering days across all phases

Phases can overlap. Phase 1 ships independently. Phases 2-4 are parallel-izable.

---

## 10. Decision Log

Key trade-off decisions made in this document:

| Decision | Alternative considered | Why this choice |
|----------|----------------------|-----------------|
| **Keep Tier 0 permanently** | Deprecate after daemon ships | Tier 0 is the onboarding ramp. Removing it kills experimentation. |
| **Auto-detect tier, don't configure it** | `mode = "daemon"` in config.toml | Emergent behavior is simpler. User never thinks about tiers. |
| **Warn on Tier 0, don't block** | Refuse to run without daemon | Blocking kills adoption. Warnings inform without friction. |
| **Password for config reload** | HMAC tokens, session keys | Password is what the user has that the agent doesn't. Simplest auth. |
| **One-time Tier 0 warning** | Warning on every command | Per-command warnings are hostile UX. One-time is sufficient. |
| **Persistent amber banner in TUI** | Dismissable warning | Security posture should be always-visible, not one-time. |
| **Interactive menu in install.sh** | Env var only (`FENCE_TIER=...`) | Interactive is better UX for humans. Reads from `/dev/tty` so `curl \| sh` works. Env var kept as automation/CI escape hatch. |
| **Docker setup inside install.sh** | Separate multi-step instructions | One flow, one terminal, zero tab switching. Script handles compose file, password, pull, start, mnemonic display. |
| **Oracle fail-closed** | Continue graceful degradation | The #1 attack vector. 5-min cache covers 99.9% of real outages. |
| **Upper bound on config values** | Any positive number valid | Limits blast radius of config tampering in Tier 0. |
| **No Windows native** | Full Windows support | WSL2 covers the use case. Native would be disproportionate effort. |
| **Tiers share ~/.onlyfence/ data** | Separate data dirs per tier | Zero-migration upgrades. Same keystore everywhere. |
| **$50 recommended max for Tier 0** | No recommendation | Sets user expectations without restricting functionality. |

---

## 11. Security Guarantee by Tier

### Tier 0 (Experimental)

> OnlyFence **reduces but does not eliminate** the risk of a prompt-injected agent executing unauthorized transactions. Config upper bounds cap the maximum single trade. Oracle fail-closed prevents unlimited USD trading. File permissions prevent cross-user access. **For wallets holding more than $50, upgrade to Tier 1 or 2.**

### Tier 1 (Daemon)

> OnlyFence **guarantees** that an autonomous agent can only execute blockchain transactions that pass the wallet owner's policy checks, provided: (1) the daemon is running, (2) the agent does not have root access, (3) the OnlyFence installation is not writable by the agent.

### Tier 2 (Docker)

> OnlyFence provides the **strongest guarantee**: the agent has zero access to the daemon's filesystem, process space, or memory. The only attack surface is the TCP socket, which enforces the full policy pipeline on every request. All attacks except socket-based trade intents are eliminated by container namespace isolation.
