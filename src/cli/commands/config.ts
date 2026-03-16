import type { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { loadConfig, initConfig, CONFIG_PATH } from '../../config/loader.js';
import { validateConfig } from '../../config/schema.js';
import { serializeToToml } from '../../config/serializer.js';
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

        if (key) {
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
        const tomlString = serializeToToml(raw, ['OnlyFence Configuration']);
        writeFileSync(CONFIG_PATH, tomlString, 'utf-8');

        console.log(`Set ${key} = ${JSON.stringify(parsedValue)}`);
      } catch (err: unknown) {
        console.error(`Error: ${toErrorMessage(err)}`);
        process.exitCode = 1;
      }
    });
}

/**
 * Get a nested value from an object using a dot-notation key path.
 *
 * @param obj - The object to traverse
 * @param keyPath - Dot-separated key path (e.g., "chain.sui.limits")
 * @returns The value at the key path, or undefined if not found
 */
function getNestedValue(obj: unknown, keyPath: string): unknown {
  const parts = keyPath.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Set a nested value on an object using a dot-notation key path.
 * Creates intermediate objects as needed.
 *
 * @param obj - The object to modify
 * @param keyPath - Dot-separated key path
 * @param value - The value to set
 */
function setNestedValue(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const parts = keyPath.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) {
      throw new Error(`Invalid key path: "${keyPath}"`);
    }
    const next = current[part];
    if (next === undefined || next === null || typeof next !== 'object') {
      const newObj: Record<string, unknown> = {};
      current[part] = newObj;
      current = newObj;
    } else {
      current = next as Record<string, unknown>;
    }
  }

  const lastPart = parts[parts.length - 1];
  if (!lastPart) {
    throw new Error(`Invalid key path: "${keyPath}"`);
  }
  current[lastPart] = value;
}

/**
 * Parse a config value string into its appropriate type.
 * Supports: numbers, booleans, JSON arrays, and plain strings.
 *
 * @param value - The string value to parse
 * @returns The parsed value
 */
function parseConfigValue(value: string): unknown {
  // Try number
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return parseFloat(value);
  }

  // Try boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Try JSON array
  if (value.startsWith('[')) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      // Fall through to string
    }
  }

  // Plain string
  return value;
}
