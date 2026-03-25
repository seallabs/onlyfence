---
sidebar_position: 11
title: FAQ
---

# FAQ

## General

### Is OnlyFence free?

Yes, 100% free and open source. No hidden fees, no premium tier, no account needed.

### Is my wallet safe?

Your private keys are encrypted and stored locally on your computer. They never leave your machine. OnlyFence doesn't have servers — everything runs locally.

### What if I lose my mnemonic phrase?

If you lose your mnemonic, you lose access to your wallet. OnlyFence cannot recover it for you. Write it down and store it somewhere safe when you first run `fence setup`.

### Can I use my existing wallet?

Yes. During `fence setup`, choose "Import existing private key or mnemonic" to use a wallet you already have. You can also import by private key using `fence wallet import-key`.

## Trading

### What happens if the price oracle is down?

OnlyFence uses a **fail-closed** approach. If the oracle is unreachable, it falls back to a cached price for up to 5 minutes. If the cache is stale or absent, the trade is **rejected** — not silently allowed. Token allowlist checks always apply regardless of oracle status.

### Does OnlyFence charge any fees on trades?

No. OnlyFence doesn't take any fees. You only pay the normal blockchain gas fees and any DEX fees from the swap itself.

### Which DEXes are supported?

On Sui, swaps route through the 7K Aggregator which finds the best price across Cetus, DeepBook, Bluefin, FlowX, and Turbos.

## Deployment

### Can I run this on a server / VPS / Kubernetes?

Yes. OnlyFence runs standalone on any machine, or as a Docker container on Docker Compose, Kubernetes, ECS, or any container runtime. See [Docker Deployment](./deployment/docker) and [Kubernetes Deployment](./deployment/kubernetes) for setup guides.

### Can multiple agents connect to the same instance?

Yes, when running in daemon mode. Multiple agents can connect to the same daemon via TCP. All agents share the same wallet and policy rules.

## Integration

### Which AI agents work with OnlyFence?

Any agent that can execute shell commands works with OnlyFence — Claude, ChatGPT, custom bots, scripts, or any tool that can call `fence` commands and parse JSON.

### Is there a REST API?

Not currently. OnlyFence uses a CLI interface with `--output json` for structured responses. The daemon accepts TCP connections. A REST API is under consideration for future releases.
