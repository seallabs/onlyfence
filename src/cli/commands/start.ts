import type { Command } from 'commander';
import type { AppConfig } from '../../types/config.js';

/**
 * Register the `fence start` command.
 *
 * Before starting, verifies the HMAC-signed config snapshot from the
 * previous run. If the config has changed, the user must review the
 * diff (or full config if snapshot is missing/tampered) and confirm.
 */
export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start the OnlyFence daemon (promotes to Tier 1)')
    .option('-d, --detach', 'Run daemon in background', false)
    .option('--tcp-host <host>', 'TCP bind address', '127.0.0.1')
    .option('--tcp-port <port>', 'TCP port', '19876')
    .option('--allow-remote', 'Allow non-loopback TCP connections', false)
    .option('--password-file <path>', 'Read password from file instead of prompting')
    .option('-y, --yes', 'Skip confirmation prompt (still requires password)', false)
    .action(
      async (options: {
        detach: boolean;
        tcpHost: string;
        tcpPort: string;
        allowRemote: boolean;
        passwordFile?: string;
        yes: boolean;
      }) => {
        // Can we resolve the password from the CLI side?
        // When forked in detached mode, stdin is a pipe carrying the password —
        // there's no TTY and no env/file source. In that case, the daemon's
        // internal resolvePassword() reads the password from stdin directly.
        const canResolvePassword =
          process.stdin.isTTY ||
          options.passwordFile !== undefined ||
          process.env['FENCE_PASSWORD'] !== undefined ||
          process.env['FENCE_PASSWORD_FILE'] !== undefined;

        if (canResolvePassword) {
          const { resolveCliPassword } = await import('../password.js');
          const password = await resolveCliPassword({ passwordFile: options.passwordFile });

          await verifyConfigBeforeStart(password as string, options.yes);

          const { launchDaemon } = await import('../daemon-lifecycle.js');
          await launchDaemon({ password, ...options });
        } else {
          // Forked child: password arrives via stdin pipe.
          // Parent already verified config snapshot — go straight to daemon startup.
          const { startDaemon } = await import('../../daemon/index.js');
          await startDaemon({
            tcpHost: options.tcpHost,
            tcpPort: parseInt(options.tcpPort, 10),
            allowRemote: options.allowRemote,
          });
        }
      },
    );
}

/**
 * Verify the signed config snapshot and require user confirmation if
 * the config has changed, the snapshot was tampered with, or no
 * snapshot exists.
 */
async function verifyConfigBeforeStart(password: string, skipConfirm: boolean): Promise<void> {
  const { verifySignedSnapshot } = await import('../../daemon/config-snapshot-file.js');
  const { loadConfig } = await import('../../config/loader.js');
  const { confirmOrExit, showFullConfig } = await import('../daemon-lifecycle.js');

  let diskConfig: AppConfig;
  try {
    diskConfig = loadConfig();
  } catch {
    // Config doesn't exist yet (pre-setup) — nothing to verify
    return;
  }

  const snapshot = verifySignedSnapshot(password);

  switch (snapshot.status) {
    case 'valid': {
      const { computeConfigDiff, formatConfigDiff } = await import('../config-diff.js');
      const changes = computeConfigDiff(snapshot.config, diskConfig);
      if (changes.length === 0) return;

      process.stderr.write(formatConfigDiff(changes));
      await confirmOrExit(
        'Config has changed since last run. Start with this config? [y/N] ',
        skipConfirm,
      );
      return;
    }
    case 'tampered': {
      process.stderr.write(
        '\n' +
          '╔══════════════════════════════════════════════════════════════════╗\n' +
          '║  WARNING: Config snapshot has been tampered with               ║\n' +
          '║                                                                ║\n' +
          '║  The signed config from the previous daemon run failed HMAC    ║\n' +
          '║  verification. This could mean an agent or attacker modified   ║\n' +
          '║  the snapshot file to hide config changes.                     ║\n' +
          '╚══════════════════════════════════════════════════════════════════╝\n\n',
      );
      showFullConfig(diskConfig);
      await confirmOrExit('Review the config above. Start with this config? [y/N] ', skipConfirm);
      return;
    }
    case 'missing': {
      process.stderr.write('No previous config snapshot found. Showing current config:\n\n');
      showFullConfig(diskConfig);
      await confirmOrExit('Start daemon with this config? [y/N] ', skipConfirm);
      return;
    }
  }
}
