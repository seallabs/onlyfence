---
title: "The Secret 12 Words: Understanding Your Mnemonic Phrase"
description: "The only thing standing between your AI agent and your funds is a mnemonic phrase. Here is what you need to know."
og:image: "/img/education-banner.png"
date: 2026-03-24
---

# The Secret 12 Words: Understanding Your Mnemonic Phrase 🗝️

![DeFi Education](/img/education-banner.png)

When you first set up OnlyFence using the `fence setup` command, it will show you a list of 12 (or 24) random words. These words are your **Mnemonic Phrase**, also known as a **Seed Phrase**.

<!-- truncate -->

## What is a Mnemonic Phrase?

Think of a Mnemonic Phrase as the **master key** to your entire digital vault. In the world of blockchain, your "wallet" isn't actually stored in your computer. It is stored on the ledger (the blockchain). The Mnemonic Phrase is a human-readable way to access that wallet from anywhere.

If you lose your computer or delete OnlyFence, you can type these 12 words into any SUI-compatible wallet (like Sui Wallet or Martian), and your funds will instantly reappear.

## The Most Important Security Rule

Because the Mnemonic Phrase is the master key, **anyone who has it has full control over your money**. No one, including the OnlyFence developers or the SUI Foundation, can change it or recover it for you.

*   **DON'T** screenshot it.
*   **DON'T** email it to yourself.
*   **DON'T** save it as a text file on your desktop.
*   **DO** write it down on physical paper and store it in a safe place.

## How OnlyFence Protects Your Key

OnlyFence follows a **Non-custodial** approach. This means:

1.  **Local Storage:** Your private keys are encrypted with your password and stored ONLY on your own machine.
2.  **Zero Visibility:** OnlyFence servers (if they even existed) never see or touch your keys.
3.  **Local Security:** Your agent can only sign transactions that pass the safety guardrails you set locally.

> "A mnemonic phrase is your superpower in DeFi. Use it wisely, and keep it safe."

By understanding how your mnemonic phrase works, you are taking the first step towards truly owning your financial future—one word at a time.

import DeployBox from '@site/src/components/DeployBox';

<DeployBox />
