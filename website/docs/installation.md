---
sidebar_position: 2
title: Installation
description: Install OnlyFence with one command on macOS or Linux. No account needed — Node.js runtime is bundled.
---

# Installation

## One-Command Install

Takes about 30 seconds. No account needed.

```bash
curl -fsSL https://raw.githubusercontent.com/seallabs/onlyfence/main/install.sh | sh
```

The installer downloads the latest release, sets up the binary, and runs `fence setup` to create your wallet and config.

### Install a Specific Version

```bash
curl -fsSL https://raw.githubusercontent.com/seallabs/onlyfence/main/install.sh | ONLYFENCE_VERSION=0.2.0 sh
```

## Build from Source

Requires **Node.js >= 25**.

```bash
git clone https://github.com/seallabs/onlyfence.git
cd onlyfence
npm install && npm run build
```

## Requirements

- **macOS** (Intel or Apple Silicon) or **Linux** (x64 or ARM64)
- No other dependencies — Node.js runtime is bundled in the standalone binary

## Verify Installation

After installation, verify everything is working:

```bash
fence --version
```

## Uninstall

```bash
fence uninstall
```

This removes the binary and optionally cleans up `~/.onlyfence/` data.
