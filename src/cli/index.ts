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
  registerStatsCommand,
  registerUpdateCommand,
  registerUnlockCommand,
  registerLockCommand,
} from './commands/index.js';
import { withTiming } from './middleware.js';
import { toErrorMessage } from '../utils/index.js';
import { createLogger, getLogger, hasLogger } from '../logger/index.js';
import { captureException, closeSentry } from '../telemetry/index.js';
import {
  CURRENT_VERSION,
  createUpdateChecker,
  createUpdateInstaller,
  registerUpdateCheckHook,
  isBackgroundCheckProcess,
  runBackgroundCheck,
} from '../update/index.js';

/**
 * Log, report, and print a fatal error. Used by all global error handlers.
 */
function handleFatalError(err: unknown): void {
  if (hasLogger()) {
    getLogger().fatal({ err: toErrorMessage(err) }, 'Fatal error');
  }
  captureException(err);
  console.error(`Fatal error: ${toErrorMessage(err)}`);
  process.exitCode = 1;
}

/**
 * Create and configure the OnlyFence CLI program.
 *
 * The program uses lazy bootstrapping: components are only initialized
 * when a command that needs them is executed. This allows commands like
 * `fence config init` and `fence setup` to run without a pre-existing config.
 *
 * @returns Configured Commander program instance and a cleanup function
 */
export function createProgram(): { program: Command; cleanup: () => void } {
  const program = new Command();

  program
    .name('fence')
    .description('OnlyFence — AI trading agent guardrails')
    .version(CURRENT_VERSION)
    .option('--verbose', 'Enable debug logging to stderr', false);

  // Lazy bootstrap: only initialize components when needed.
  // Commands that need full app context call getComponents().
  let cachedComponents: AppComponents | undefined;

  function getComponents(): AppComponents {
    cachedComponents ??= bootstrap();
    return cachedComponents;
  }

  /** Close all resources. Safe to call multiple times. */
  function cleanup(): void {
    cachedComponents?.close();
  }

  // Initialize logger before any command runs
  program.hook('preAction', (thisCommand: Command) => {
    if (!hasLogger()) {
      const opts = thisCommand.optsWithGlobals<{ verbose?: boolean }>();
      createLogger({ verbose: opts.verbose === true });
    }
  });

  // Automatic command timing (Phase 2)
  withTiming(program, () => cachedComponents?.cliEventLog);

  // Non-blocking update check: reads cache (~1ms), spawns background
  // refresh when stale. Never blocks the main command.
  const checker = createUpdateChecker();
  registerUpdateCheckHook(program, checker, CURRENT_VERSION);

  // Register commands
  registerSetupCommand(program);
  registerSwapCommand(program, getComponents);
  registerQueryCommand(program, getComponents);
  registerConfigCommand(program);
  registerWalletCommand(program, getComponents);
  registerStatsCommand(program, getComponents);
  registerUpdateCommand(program, checker, createUpdateInstaller(), CURRENT_VERSION);
  registerUnlockCommand(program);
  registerLockCommand(program);

  // Default action: launch interactive TUI when no subcommand is given.
  // If bootstrap fails (first run), the TUI shows a setup wizard.
  program.action(async () => {
    const { launchTui, tryBootstrap } = await import('../tui/index.js');
    const components = tryBootstrap();
    await launchTui(components);
  });

  return { program, cleanup };
}

// --- Global error handlers ---

process.on('uncaughtException', (err: Error) => {
  handleFatalError(err);
});

process.on('unhandledRejection', (reason: unknown) => {
  handleFatalError(reason);
});

// Handle background update check process — exit early, no Commander parsing.
if (isBackgroundCheckProcess()) {
  void runBackgroundCheck().finally(() => process.exit(0));
} else {
  // Run CLI when this is the entry point
  const { program, cleanup } = createProgram();

  // Ensure resources are released on signal (process.exit triggers 'exit' which runs cleanup)
  function gracefulShutdown(code: number): void {
    cleanup();
    void closeSentry().finally(() => process.exit(code));
  }

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    gracefulShutdown(130);
  });
  process.on('SIGTERM', () => {
    gracefulShutdown(143);
  });

  void program
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      handleFatalError(err);
    })
    .finally(async () => {
      cleanup();
      await closeSentry();
    });
}
