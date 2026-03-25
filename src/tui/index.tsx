import { render } from 'ink';
import { bootstrap } from '../cli/bootstrap.js';
import type { AppComponents } from '../cli/bootstrap.js';
import { loadConfig } from '../config/loader.js';
import { initSentry } from '../telemetry/sentry.js';
import { toErrorMessage } from '../utils/index.js';
import { createUpdateChecker } from '../update/index.js';
import { App } from './App.js';
import { SetupApp } from './SetupApp.js';
import { TelemetryPrompt } from './screens/TelemetryPrompt.js';

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[H\x1b[2J';

/**
 * Launch the interactive TUI.
 *
 * If bootstrap succeeds, launches the main app directly.
 * If bootstrap fails (no config/DB), shows the setup wizard first,
 * then the telemetry consent prompt, then re-bootstraps and enters the main app.
 *
 * Enters the terminal alternate screen for a clean full-screen experience
 * and restores the original screen on exit.
 */
export async function launchTui(components?: AppComponents): Promise<void> {
  process.stdout.write(ENTER_ALT_SCREEN);
  process.stdout.write(CLEAR_SCREEN);

  // Ensure alternate screen is exited even on unexpected signals
  const exitAltScreen = (): void => {
    process.stdout.write(EXIT_ALT_SCREEN);
  };
  process.on('SIGINT', exitAltScreen);
  process.on('SIGTERM', exitAltScreen);

  // Create the update checker once — shared across the entire TUI session.
  const updateChecker = createUpdateChecker();

  try {
    if (components !== undefined) {
      // Bootstrap succeeded — check if telemetry prompt is needed
      if (components.config.telemetry === undefined) {
        await showTelemetryPrompt();
        // Reload only the config (avoid full re-bootstrap which re-opens DB)
        const refreshedConfig = loadConfig();
        initSentry(refreshedConfig.telemetry?.enabled ?? false);
        const refreshed: AppComponents = { ...components, config: refreshedConfig };
        const instance = render(<App components={refreshed} updateChecker={updateChecker} />);
        await instance.waitUntilExit();
      } else {
        const instance = render(<App components={components} updateChecker={updateChecker} />);
        await instance.waitUntilExit();
      }
    } else {
      // Bootstrap failed — run setup wizard first
      await runSetupThenApp(updateChecker);
    }
  } finally {
    process.off('SIGINT', exitAltScreen);
    process.off('SIGTERM', exitAltScreen);
    exitAltScreen();
  }
}

/**
 * Show the telemetry consent prompt and wait for user choice.
 */
async function showTelemetryPrompt(): Promise<void> {
  process.stdout.write(CLEAR_SCREEN);

  await new Promise<void>((resolve) => {
    const instance = render(
      <TelemetryPrompt
        onComplete={() => {
          instance.unmount();
          resolve();
        }}
      />,
    );
  });
}

/**
 * Show the setup wizard, telemetry prompt, wait for completion,
 * then bootstrap and launch main app.
 */
async function runSetupThenApp(
  updateChecker: ReturnType<typeof createUpdateChecker>,
): Promise<void> {
  // Phase 1: Setup wizard
  await new Promise<void>((resolve) => {
    const instance = render(
      <SetupApp
        onComplete={() => {
          instance.unmount();
          resolve();
        }}
      />,
    );
  });

  // Phase 2: Clear and launch main app
  process.stdout.write(CLEAR_SCREEN);

  const components = bootstrap();
  const instance = render(<App components={components} updateChecker={updateChecker} />);
  await instance.waitUntilExit();
}

/**
 * Attempt bootstrap. Returns components on success, undefined on failure.
 */
export function tryBootstrap(): AppComponents | undefined {
  try {
    return bootstrap();
  } catch (err: unknown) {
    const msg = toErrorMessage(err);
    // Only fall through to setup for missing config/DB — rethrow other errors
    if (msg.includes('not found') || msg.includes('ENOENT')) {
      return undefined;
    }
    throw err;
  }
}
