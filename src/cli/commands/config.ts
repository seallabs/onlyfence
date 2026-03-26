import type { Command } from 'commander';
import { loadConfig, initConfig, updateConfigFile, CONFIG_PATH } from '../../config/loader.js';
import { getNestedValue, setNestedValue, parseConfigValue } from '../../config/utils.js';
import { toErrorMessage } from '../../utils/index.js';

/**
 * Register the `fence config` command group.
 *
 * Subcommands:
 * - `fence config init`        - Create default config.toml
 * - `fence config show [key]`  - Show full config or a specific key path
 * - `fence config set <key> <value>` - Set a config value
 */
export function registerConfigCommand(program: Command): void {
  const configCmd = program.command('config').description('Manage OnlyFence configuration');

  // fence config init
  configCmd
    .command('init')
    .description('Initialize default config.toml')
    .option('-f, --force', 'Overwrite existing config', false)
    .action((options: { force: boolean }) => {
      try {
        const path = initConfig(CONFIG_PATH, options.force);
        console.log(`Configuration initialized at ${path}`);
      } catch (err: unknown) {
        console.error(`Error: ${toErrorMessage(err)}`);
        process.exitCode = 1;
      }
    });

  // fence config show [key]
  configCmd
    .command('show [key]')
    .description('Show configuration (optionally a specific key path)')
    .action((key?: string) => {
      try {
        const config = loadConfig(CONFIG_PATH);

        if (key !== undefined) {
          const value = getNestedValue(config, key);
          if (value === undefined) {
            throw new Error(`Key "${key}" not found in configuration.`);
          }
          console.log(JSON.stringify(value, null, 2));
        } else {
          console.log(JSON.stringify(config, null, 2));
        }
      } catch (err: unknown) {
        console.error(`Error: ${toErrorMessage(err)}`);
        process.exitCode = 1;
      }
    });

  // fence config set <key> <value>
  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value (dot-notation key path)')
    .action(async (key: string, value: string) => {
      try {
        const parsedValue = parseConfigValue(value);
        updateConfigFile((raw) => {
          setNestedValue(raw, key, parsedValue);
        });

        console.log(`Set ${key} = ${JSON.stringify(parsedValue)}`);
      } catch (err: unknown) {
        console.error(`Error: ${toErrorMessage(err)}`);
        process.exitCode = 1;
        return;
      }

      // Best-effort warning if daemon is running: file changes are NOT applied until restart
      try {
        const { isDaemonRunning } = await import('../../daemon/index.js');
        if (isDaemonRunning()) {
          console.error(
            '\nNote: The daemon is running and uses its own config snapshot.\n' +
              '  This change will NOT take effect until you run:\n' +
              '    fence restart    Review diff and restart with password\n',
          );
        }
      } catch {
        // Daemon module unavailable — skip warning
      }
    });
}
