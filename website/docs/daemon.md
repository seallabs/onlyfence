---
sidebar_position: 7
title: Daemon Mode
description: Run OnlyFence as a background daemon for persistent AI agent connections. Keeps wallets unlocked in memory and listens on a TCP socket.
---

# Daemon Mode

OnlyFence can run as a background daemon for persistent agent connections. The daemon keeps your wallet unlocked in memory and listens on a TCP socket for commands.

## Starting the Daemon

```bash
fence start
```

The daemon runs in the background. It prompts for your wallet password on first start, then keeps the session alive.

## Connecting to the Daemon

Your agent sends commands to the daemon via the `--addr` flag:

```bash
fence swap SUI USDC 100 --addr 127.0.0.1:19876 --output json
```

## Daemon Management

```bash
fence status    # Check if the daemon is running
fence stop      # Stop the daemon
fence reload    # Reload configuration without restarting
```

## Architecture

```
+-------------------+       +-------------------+
|  AI Agent         |  TCP  |  OnlyFence Daemon |
|  (any process)    |------>|  (background)     |
|                   |:19876 |                   |
|  No keys          |       |  Keys in memory   |
|  No password      |       |  Guardrails apply |
+-------------------+       +-------------------+
```

## Security Hardening

The daemon includes production-grade security measures:

| Feature | Description |
|---------|-------------|
| **Loopback-only binding** | Listens on `127.0.0.1` — not exposed to the network |
| **Process hardening** | `PR_SET_DUMPABLE=0` on Linux, `PT_DENY_ATTACH` on macOS |
| **Password authentication** | IPC connections require password authentication |
| **Memory protection** | Keys held in memory are protected from process dumps |

## Using with Docker

When running OnlyFence in a Docker container, the daemon starts automatically. See [Docker Deployment](./deployment/docker) for the full setup guide.
