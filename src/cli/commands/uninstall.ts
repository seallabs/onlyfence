import type { Command } from 'commander';

/**
 * Register the `fence uninstall` command.
 *
 * Completely removes OnlyFence: stops daemon, deletes entire install
 * directory (binary, runtime, keystore, config, logs), cleans PATH from
 * shell profiles, and removes Claude Code plugin.
 */
export function registerUninstallCommand(program: Command): void {
  program
    .command('uninstall')
    .description('Completely remove OnlyFence and all its data from this machine')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (opts: { yes?: boolean }) => {
      const { readFileSync, writeFileSync, rmSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');
      const { execFileSync } = await import('node:child_process');
      const { isEnoentError } = await import('../../utils/index.js');
      const { ONLYFENCE_DIR } = await import('../../config/loader.js');
      const { isDaemonRunning } = await import('../../daemon/index.js');
      const { stopDaemonGracefully } = await import('../../daemon/stop-helper.js');
      const { bold, red, dim, info, success, warn } = await import('../style.js');

      if (opts.yes !== true) {
        const confirmed = await promptUninstallConfirmation(ONLYFENCE_DIR, {
          bold,
          red,
          dim,
          info,
          warn,
        });
        if (!confirmed) return;
      }

      // 1. Stop daemon
      if (isDaemonRunning()) {
        info('Stopping daemon...');
        await stopDaemonGracefully();
        success('Daemon stopped.');
      }

      // 2. Clean shell profiles before removing the directory so PATH
      //    cleanup happens even if rmSync partially fails.
      const home = homedir();
      const fishConfigDir = process.env['XDG_CONFIG_HOME'] ?? join(home, '.config');
      const shellProfiles = [
        join(home, '.zshrc'),
        join(home, '.bashrc'),
        join(home, '.bash_profile'),
        join(home, '.profile'),
        join(fishConfigDir, 'fish', 'config.fish'),
      ];

      for (const profile of shellProfiles) {
        try {
          const content = readFileSync(profile, 'utf-8');
          if (!content.includes('.onlyfence/bin')) continue;

          const cleaned = content
            .split('\n')
            .filter((line) => {
              if (line.includes('.onlyfence/bin')) return false;
              if (line === '# OnlyFence') return false;
              return true;
            })
            .join('\n');

          if (cleaned !== content) {
            writeFileSync(profile, cleaned);
            success(`Cleaned PATH from ${profile}`);
          }
        } catch (err: unknown) {
          if (isEnoentError(err)) continue;
          throw err;
        }
      }

      // 3. Remove Claude Code plugin
      try {
        execFileSync('claude', ['plugin', 'uninstall', 'onlyfence@onlyfence'], { stdio: 'ignore' });
        execFileSync('claude', ['plugin', 'marketplace', 'remove', 'seallabs/onlyfence'], {
          stdio: 'ignore',
        });
        success('Claude Code plugin removed.');
      } catch {
        // Claude CLI not installed or plugin not present — both are fine
      }

      // 4. Remove the entire install directory (binary, runtime, keystore, config, logs)
      info(`Removing ${ONLYFENCE_DIR}...`);
      try {
        rmSync(ONLYFENCE_DIR, { recursive: true, force: true });
      } catch (err: unknown) {
        if (!isEnoentError(err)) throw err;
      }

      // 5. Verify removal
      if (existsSync(ONLYFENCE_DIR)) {
        warn(`Could not fully remove ${ONLYFENCE_DIR} — please delete it manually.`);
      } else {
        success(`Removed ${ONLYFENCE_DIR}`);
      }

      console.log('');
      success(bold('OnlyFence has been completely removed from this machine.'));
      info('Restart your shell to finish PATH cleanup.');
      console.log('');
    });
}

/** Style helpers subset needed by the confirmation prompt. */
interface PromptStyles {
  bold: (s: string) => string;
  red: (s: string) => string;
  dim: (s: string) => string;
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

const CONFIRM_WORD = 'uninstall';

async function promptUninstallConfirmation(
  installDir: string,
  style: PromptStyles,
): Promise<boolean> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('');
  style.warn(`This will ${style.bold('completely remove')} OnlyFence from this machine:`);
  console.log('');
  console.log(`    ${style.dim('•')} The ${style.bold('fence')} CLI binary and bundled runtime`);
  console.log(`    ${style.dim('•')} Encrypted keystore (wallet private keys)`);
  console.log(`    ${style.dim('•')} Configuration, trade history, and logs`);
  console.log(`    ${style.dim('•')} Daemon process and socket`);
  console.log(`    ${style.dim('•')} Shell PATH entries`);
  console.log(`    ${style.dim('•')} Claude Code plugin`);
  console.log('');
  console.log(`    ${style.dim(`Everything under ${installDir} will be deleted.`)}`);
  console.log('');
  style.warn(
    style.red('This action cannot be undone. Make sure you have your mnemonic backed up.'),
  );
  console.log('');

  const answer = await new Promise<string>((resolve) => {
    rl.question(`  Type ${style.bold(CONFIRM_WORD)} to confirm: `, resolve);
  });
  rl.close();

  if (answer.trim() !== CONFIRM_WORD) {
    style.info('Uninstall cancelled.');
    return false;
  }

  console.log('');
  return true;
}
