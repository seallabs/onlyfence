#!/usr/bin/env node

import { Command } from 'commander';
import { bootstrap } from './bootstrap.js';
import type { AppComponents } from './bootstrap.js';
import {
  registerSetupCommand,
  registerSwapCommand,
  registerQueryCommand,
  registerConfigCommand,
  registerWalletCommand,
} from './commands/index.js';
import { toErrorMessage } from '../utils/index.js';

/**
 * Create and configure the OnlyFence CLI program.
 *
 * The program uses lazy bootstrapping: components are only initialized
 * when a command that needs them is executed. This allows commands like
 * `fence config init` and `fence setup` to run without a pre-existing config.
 *
 * @returns Configured Commander program instance
 */
export function createProgram(): Command {
  const program = new Command();

  program.name('fence').description('OnlyFence — AI trading agent guardrails').version('0.1.0');

  // Lazy bootstrap: only initialize components when needed.
  // Commands that need full app context call getComponents().
  let cachedComponents: AppComponents | undefined;

  function getComponents(): AppComponents {
    cachedComponents ??= bootstrap();
    return cachedComponents;
  }

  // Register commands
  registerSetupCommand(program);
  registerSwapCommand(program, getComponents);
  registerQueryCommand(program, getComponents);
  registerConfigCommand(program);
  registerWalletCommand(program, getComponents);

  // Default action: launch interactive TUI when no subcommand is given.
  // If bootstrap fails (first run), the TUI shows a setup wizard.
  program.action(async () => {
    const { launchTui, tryBootstrap } = await import('../tui/index.js');
    const components = tryBootstrap();
    await launchTui(components);
  });

  return program;
}

// Run CLI when this is the entry point
const program = createProgram();
program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`Fatal error: ${toErrorMessage(err)}`);
  process.exitCode = 1;
});
