import { createInterface } from 'node:readline';
import type { Command } from 'commander';
import type { UpdateChecker } from '../../update/checker.js';
import type { UpdateInstaller } from '../../update/installer.js';
import { loadConfig } from '../../config/loader.js';
import { toErrorMessage } from '../../utils/index.js';
import { hasLogger, getLogger } from '../../logger/index.js';

/**
 * Register the `fence update` command.
 *
 * Checks GitHub Releases for a newer version and optionally installs it.
 * Respects the `update.auto_install` config setting:
 * - auto_install = true: installs without prompting
 * - auto_install = false or absent: prompts the user before installing
 */
export function registerUpdateCommand(
  program: Command,
  checker: UpdateChecker,
  installer: UpdateInstaller,
  currentVersion: string,
): void {
  program
    .command('update')
    .description('Check for and install updates')
    .option('--check-only', 'Only check for updates, do not install', false)
    .action(async (options: { checkOnly: boolean }) => {
      try {
        console.log('Checking for updates...');

        const status = await checker.checkFromSource(currentVersion);

        if (status.kind === 'up-to-date') {
          console.log(`Already on the latest version (v${currentVersion}).`);
          return;
        }

        if (status.kind === 'unknown') {
          console.error('Could not determine the latest version.');
          process.exitCode = 1;
          return;
        }

        console.log(`Update available: v${status.currentVersion} → v${status.latestVersion}`);

        if (options.checkOnly) {
          console.log('Run "fence update" to install.');
          return;
        }

        const shouldInstall = await resolveInstallDecision();
        if (!shouldInstall) {
          console.log('Update skipped. Run "fence update" when ready.');
          return;
        }

        console.log(`Installing v${status.latestVersion}...`);
        await installer.install(status.latestVersion);
        console.log(`\nUpdate complete! Restart fence to use v${status.latestVersion}.`);
      } catch (err: unknown) {
        console.error(`Error: ${toErrorMessage(err)}`);
        process.exitCode = 1;
      }
    });
}

/**
 * Determine whether to proceed with installation based on config + user input.
 *
 * If `update.auto_install` is true in config, returns true immediately.
 * Otherwise, prompts the user via stdin.
 */
async function resolveInstallDecision(): Promise<boolean> {
  // Try to read config for auto_install preference
  try {
    const config = loadConfig();
    if (config.update?.auto_install === true) {
      return true;
    }
  } catch (err: unknown) {
    // "Configuration file not found" is expected on first run — fall through to prompt.
    // Any other error (corrupt TOML, validation failure) should be logged.
    const msg = toErrorMessage(err);
    if (!msg.includes('Configuration file not found') && hasLogger()) {
      getLogger().warn({ err: msg }, 'Could not load config for auto_install preference');
    }
  }

  // Non-TTY stdin (piped, CI) — default to no install
  if (!process.stdin.isTTY) {
    return false;
  }

  return promptUserConfirmation('Install update? [y/N]: ');
}

/**
 * Prompt the user for a yes/no confirmation via readline.
 */
function promptUserConfirmation(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}
