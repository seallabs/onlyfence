---
title: "Beyond the Mouse: Why Every AI Agent Uses a CLI"
description: "Understanding the Command Line Interface (CLI) and why it is the native language of autonomous DeFi agents."
og:image: "/img/education-banner.png"
date: 2026-03-24
---

# Beyond the Mouse: Why Every AI Agent Uses a CLI 🖱️🚫

![DeFi Education](/img/education-banner.png)

If you have ever used a Mac or PC, you are likely used to the **GUI (Graphical User Interface)**—clicking icons, dragging files, and scrolling through menus. But if you look at how OnlyFence interacts with your AI agent, you will see a lot of text-based commands. This is called a **CLI**, or **Command Line Interface**.

<!-- truncate -->

## What is a CLI?

A Command Line Interface is a way of interacting with a computer program by typing lines of text (commands) into a terminal. Instead of clicking a "Swap" button, you type something like:

`fence swap SUI USDC 10`

While it might look "old school" to humans, it is the most powerful way for computers to talk to each other.

## Why Does Your AI Agent Love the CLI?

Your AI agent (like Claude, ChatGPT, or Cursor) doesn't have a finger to click a button. While it *can* look at screenshots, it is much faster and more accurate at reading and writing text.

1.  **Precision:** Commands are explicit. There is no "oops, I clicked the wrong pixel."
2.  **Speed:** Agents can execute a command in milliseconds.
3.  **Structured Data:** OnlyFence CLI can output results in **JSON** (a data format that looks like text but is organized for code). This allows the agent to immediately understand if a trade was successful or why it was blocked.

## OnlyFence: Bridging the Gap

OnlyFence provides the CLI that your agent needs to perform complex DeFi actions like swapping, lending, and borrowing. By typing simple commands, your agent can navigate the entire Sui ecosystem while staying within the "fence" you've built.

> **Pro Tip:** You don't *have* to use the CLI. OnlyFence also includes a **TUI** (Terminal User Interface) that gives you a dashboard-like experience right in your terminal just by running the `fence` command.

import DeployBox from '@site/src/components/DeployBox';

<DeployBox />
