import { render } from 'ink';
import { bootstrap } from '../cli/bootstrap.js';
import type { AppComponents } from '../cli/bootstrap.js';
import { toErrorMessage } from '../utils/index.js';
import { App } from './App.js';
import { SetupApp } from './SetupApp.js';

/**
 * Launch the interactive TUI.
 *
 * If bootstrap succeeds, launches the main app directly.
 * If bootstrap fails (no config/DB), shows the setup wizard first,
 * then re-bootstraps and enters the main app.
 *
 * Enters the terminal alternate screen for a clean full-screen experience
 * and restores the original screen on exit.
 */
export async function launchTui(components?: AppComponents): Promise<void> {
  // Enter alternate screen buffer and clear it (like vim/k9s)
  process.stdout.write('\x1b[?1049h');
  process.stdout.write('\x1b[2J\x1b[H');

  try {
    if (components) {
      // Bootstrap succeeded — go straight to the main app
      const instance = render(<App components={components} />);
      await instance.waitUntilExit();
    } else {
      // Bootstrap failed — run setup wizard first
      await runSetupThenApp();
    }
  } finally {
    // Restore original screen
    process.stdout.write('\x1b[?1049l');
  }
}

/**
 * Show the setup wizard, wait for completion, then bootstrap and launch main app.
 */
async function runSetupThenApp(): Promise<void> {
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
  process.stdout.write('\x1b[H\x1b[2J');

  const components = bootstrap();
  const instance = render(<App components={components} />);
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
