#!/usr/bin/env node

import { Command } from 'commander';
import { createLogger, getLogger, hasLogger } from '../logger/index.js';
import { sanitizeEnvironment, runStartupChecks, ensureSecureDataDir } from '../security/index.js';
import { ONLYFENCE_DIR } from '../config/loader.js';
import { assertNoPasswordInArgv } from '../security/runtime-assertions.js';
import { captureException, closeSentry } from '../telemetry/index.js';
import {
  CURRENT_VERSION,
  createUpdateChecker,
  createUpdateInstaller,
  isBackgroundCheckProcess,
  registerUpdateCheckHook,
  runBackgroundCheck,
} from '../update/index.js';
import { toErrorMessage } from '../utils/index.js';
import type { AppComponents } from './bootstrap.js';
import { bootstrap } from './bootstrap.js';
import {
  registerConfigCommand,
  registerLendCommand,
  registerLockCommand,
  registerPerpCommand,
  registerQueryCommand,
  registerRestartCommand,
  registerSetupCommand,
  registerStartCommand,
  registerStatsCommand,
  registerStatusCommand,
  registerStopCommand,
  registerSwapCommand,
  registerUninstallCommand,
  registerUnlockCommand,
  registerUpdateCommand,
  registerWalletCommand,
} from './commands/index.js';
import { withTiming } from './middleware.js';
import { warn as styleWarn } from './style.js';

/**
 * Log, report, and print a fatal error. Used by all global error handlers.
 */
/** Guard against re-entrant calls (EPIPE cascade from console.error). */
let handlingFatalError = false;

function handleFatalError(err: unknown): void {
  if (handlingFatalError) return;
  handlingFatalError = true;
  try {
    if (hasLogger()) {
      getLogger().fatal({ err: toErrorMessage(err) }, 'Fatal error');
    }
    captureException(err);
    // console.error can trigger EPIPE if stderr pipe is broken (detached daemon).
    // Catch and ignore to prevent cascading uncaughtException loops.
    try {
      console.error(`Fatal error: ${toErrorMessage(err)}`);
    } catch {
      // stderr is broken (e.g., detached daemon after parent disconnects) — ignore
    }
    process.exitCode = 1;
  } finally {
    handlingFatalError = false;
  }
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
export function createProgram(): { program: Command; cleanup: () => Promise<void> } {
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
  async function cleanup(): Promise<void> {
    await cachedComponents?.close();
  }

  // Initialize logger before any command runs
  program.hook('preAction', (thisCommand: Command) => {
    if (!hasLogger()) {
      const opts = thisCommand.optsWithGlobals<{ verbose?: boolean }>();
      createLogger({ verbose: opts.verbose === true });
    }
  });

  // Security: log sanitized env vars and run startup checks (once per process)
  let startupChecksDone = false;
  program.hook('preAction', () => {
    if (startupChecksDone) return;
    startupChecksDone = true;

    ensureSecureDataDir(ONLYFENCE_DIR);

    if (hasLogger() && removedVars.length > 0) {
      getLogger().warn({ removed: removedVars }, 'Dangerous environment variables stripped');
    }

    const warnings = runStartupChecks();
    for (const w of warnings) {
      styleWarn(`${w.message} ${w.fix}`);
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
  registerLendCommand(program, getComponents);
  registerPerpCommand(program, getComponents);
  registerQueryCommand(program, getComponents);
  registerConfigCommand(program);
  registerWalletCommand(program, getComponents);
  registerStatsCommand(program, getComponents);
  registerUpdateCommand(program, checker, createUpdateInstaller(), CURRENT_VERSION);
  registerUnlockCommand(program, getComponents);
  registerLockCommand(program);

  // Daemon commands (Tier 1/2)
  registerStartCommand(program);
  registerStopCommand(program);
  registerStatusCommand(program);
  registerRestartCommand(program);
  registerUninstallCommand(program);

  // Default action: launch interactive TUI when no subcommand is given.
  // If bootstrap fails (first run), the TUI shows a setup wizard.
  program.action(async () => {
    const { launchTui, tryBootstrap } = await import('../tui/index.js');
    const components = tryBootstrap();
    await launchTui(components);
  });

  return { program, cleanup };
}

// --- Security: sanitize environment ---
// NOTE: ES module imports are hoisted, so NODE_OPTIONS injection takes effect
// before this runs. This is a known limitation — the real defense is:
// (1) Tier 1 daemon: env is sanitized by the shell entrypoint before Node starts
// (2) Tier 2 Docker: container namespace isolation
// This call still strips vars for any *subsequent* child processes.
const removedVars = sanitizeEnvironment();

// If NODE_OPTIONS was set, injected code (e.g. --require) already ran before
// sanitizeEnvironment() could strip it. Abort immediately to prevent the CLI
// from decrypting the keystore where a hook could intercept the plaintext keys.
if (removedVars.includes('NODE_OPTIONS')) {
  console.error(
    'Security error: NODE_OPTIONS was set in the environment.\n' +
      'This variable can inject code that runs before any security checks,\n' +
      'allowing an attacker to intercept decrypted keys.\n\n' +
      'If you set NODE_OPTIONS intentionally, unset it first:\n' +
      '  unset NODE_OPTIONS && fence <command>\n\n' +
      'Refusing to continue.',
  );
  process.exit(78); // EX_CONFIG
}

// Fail fast if a password leaked into argv (developer bug)
assertNoPasswordInArgv();

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

  // Ensure resources are released on signal
  function gracefulShutdown(code: number): void {
    void cleanup()
      .then(() => closeSentry())
      .finally(() => process.exit(code));
  }

  process.on('exit', () => {
    void cleanup();
  });
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
      await cleanup();
      await closeSentry();
      // Force exit: the Bluefin SDK may leave internal handles (axios keep-alive,
      // etc.) that prevent the Node.js event loop from draining naturally.
      process.exit(process.exitCode ?? 0);
    });
}
