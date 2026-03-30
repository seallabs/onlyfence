---
sidebar_position: 1
title: Docker
description: Deploy OnlyFence as a security-hardened Docker container. The daemon runs inside the container and exposes a TCP endpoint — private keys never leave.
keywords: [Docker deployment, container, production deployment, security hardened, Docker Compose, DeFi container]
---

# Docker Deployment

OnlyFence ships as a Docker image for production deployments. The daemon runs inside the container and exposes a TCP endpoint for your agent — private keys never leave the container.

## Architecture

```
+----------------+       +------------------+
|  AI Agent      |  TCP  |  OnlyFence       |
|  (any host)    |------>|  (container)     |
|                |:19876 |                  |
|  No keys       |       |  Keys in memory  |
|  No password   |       |  Guardrails apply|
+----------------+       +------------------+
```

## Docker Compose

### 1. Create Secret Files

```bash
echo "your-mnemonic-phrase" > .fence_mnemonic
echo "your-password" > .fence_password
chmod 600 .fence_mnemonic .fence_password
```

### 2. Start

```bash
docker compose up -d
```

On first run the entrypoint automatically imports the wallet from the mnemonic and starts the daemon. On subsequent runs the keystore already exists and the mnemonic is ignored.

### 3. Connect Your Agent

```bash
fence swap SUI USDC 100 --addr 127.0.0.1:19876 --output json
```

## docker-compose.yml Reference

See [`docker-compose.yml`](https://github.com/seallabs/onlyfence/blob/main/docker-compose.yml) in the repository for the full reference configuration, including:

- Read-only filesystem
- Dropped capabilities
- No-new-privileges
- Non-root user
- Tmpfs for secrets

## Non-Interactive Setup

`fence setup` supports fully non-interactive mode for scripted environments:

```bash
# Import from file
fence setup --mnemonic-file /run/secrets/mnemonic --password-file /run/secrets/password

# Import from stdin
echo "word1 word2 ..." | fence setup --password-file /run/secrets/password

# Generate new wallet (outputs JSON with mnemonic to stdout)
fence setup --generate --password-file /run/secrets/password
```

## Container Security

The Docker image includes production hardening out of the box:

| Feature | Description |
|---------|-------------|
| **Non-root user** | Runs as `onlyfence` user, never root |
| **Read-only filesystem** | Container root is immutable (`read_only: true`) |
| **No capabilities** | All Linux capabilities dropped (`cap_drop: ALL`) |
| **No privilege escalation** | `no-new-privileges` enforced |
| **Password via file** | Secrets injected as files on tmpfs — never as environment variables |
| **Loopback-only TCP** | Daemon binds to `127.0.0.1` — not exposed to the network |
| **Process hardening** | `PR_SET_DUMPABLE=0` prevents memory dumps |
