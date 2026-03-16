import type { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { loadConfig, initConfig, CONFIG_PATH } from '../../config/loader.js';
import { validateConfig } from '../../config/schema.js';
import { serializeToToml } from '../../config/serializer.js';
import {
  getNestedValue,
  setNestedValue,
  parseConfigValue,
  CONFIG_FILE_HEADER,
} from '../../config/utils.js';
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
    .action((key: string, value: string) => {
      try {
        // Read raw TOML, parse, modify, validate, write back
        let content: string;
        try {
          content = readFileSync(CONFIG_PATH, 'utf-8');
        } catch (err: unknown) {
          throw new Error(
            `Configuration file not found. Run "fence config init" first. ` +
              `(${toErrorMessage(err)})`,
          );
        }

        const raw = parse(content) as Record<string, unknown>;
        const parsedValue = parseConfigValue(value);
        setNestedValue(raw, key, parsedValue);

        // Validate the modified config to ensure it's still valid
        validateConfig(raw);

        // Write back as TOML
        const tomlString = serializeToToml(raw, CONFIG_FILE_HEADER);
        writeFileSync(CONFIG_PATH, tomlString, 'utf-8');

        console.log(`Set ${key} = ${JSON.stringify(parsedValue)}`);
      } catch (err: unknown) {
        console.error(`Error: ${toErrorMessage(err)}`);
        process.exitCode = 1;
      }
    });
}
