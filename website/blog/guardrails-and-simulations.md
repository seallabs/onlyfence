---
title: "The Invisible Fence: How Guardrails and Simulations Prevent Disasters"
description: "Learn how OnlyFence uses 'Dry Runs' and real-time policy checks to make sure your AI agent never makes a $1,000 mistake."
og:image: "/img/education-banner.png"
date: 2026-03-24
---

# The Invisible Fence: How Guardrails and Simulations Prevent Disasters 🛡️

![DeFi Education](/img/education-banner.png)

AI agents are fast, powerful, and sometimes... a little bit too confident. A single hallucination or an error in a strategy could lead an agent to drain your entire wallet in seconds. That's why OnlyFence exists.

<!-- truncate -->

## What are Guardrails?

Think of **Guardrails** as the boundaries you set for your AI agent. In OnlyFence, these are managed in your `config` file.

*   **Allowlist:** Your agent can *only* trade the tokens you've approved (e.g., SUI, USDC, USDT).
*   **Trade Limits:** Limit the amount of money spent on a single trade (e.g., max $200).
*   **Daily Volume:** Set a maximum amount your agent can trade in a 24-hour period (e.g., max $500 total).

If your agent tries to spend $1,000 when your limit is $500, OnlyFence **immediately blocks** the action.

## What is a Simulation (Dry Run)?

Even if a trade passes your guardrails, there could be a problem with the DEX or the blockchain itself. That's where **Simulations** come in.

*   Before signing a real transaction, OnlyFence runs a **Dry Run**.
*   This is a "practice" execution on the blockchain that checks if the trade *would* work and how much it *would* cost.
*   If the dry run fails (e.g., not enough liquidity), OnlyFence stops the trade *before* any real money is spent or any gas fees are paid.

## How It All Works Together

1.  **Agent Logic:** Your agent decides to swap 10 SUI for USDC.
2.  **OnlyFence Check:** Is USDC on the allowlist? Yes. Is 10 SUI under the $200 limit? Yes.
3.  **Sui Simulation:** OnlyFence runs a dry run. The blockchain says "Success."
4.  **Transaction Signing:** OnlyFence signs the transaction with your private key and submits it.

By combining human-set boundaries with automated simulations, OnlyFence creates a safety net that lets you sleep soundly while your AI agent works hard on the blockchain.

> "Safety isn't an afterthought in DeFi—it's the foundation."

Protect your wallet and empower your agent with the invisible fence of OnlyFence.

import DeployBox from '@site/src/components/DeployBox';

<DeployBox />
