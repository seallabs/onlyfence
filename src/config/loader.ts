import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'smol-toml';
import type { AppConfig } from '../types/config.js';
import { validateConfig, createDefaultConfig, ConfigAlreadyExistsError } from './schema.js';
import { serializeToToml } from './serializer.js';
import { toErrorMessage } from '../utils/index.js';

/**
 * Default directory for OnlyFence configuration and data.
 */
export const ONLYFENCE_DIR = join(homedir(), '.onlyfence');

/**
 * Default path to the TOML configuration file.
 */
export const CONFIG_PATH = join(ONLYFENCE_DIR, 'config.toml');

/**
 * Load and parse the OnlyFence configuration from disk.
 *
 * @param configPath - Path to config.toml (defaults to ~/.onlyfence/config.toml)
 * @returns Parsed and validated AppConfig
 * @throws Error if the file does not exist or is invalid
 */
export function loadConfig(configPath: string = CONFIG_PATH): AppConfig {
  let content: string;
  try {
    content = readFileSync(configPath, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      throw new Error(
        `Configuration file not found at "${configPath}". ` +
          `Run "fence config init" to create a default configuration.`,
      );
    }
    throw new Error(`Failed to read config at "${configPath}": ${toErrorMessage(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (err) {
    throw new Error(`Failed to parse TOML config at "${configPath}": ${toErrorMessage(err)}`);
  }

  return validateConfig(parsed);
}

/**
 * Initialize the OnlyFence directory and create a default config file.
 *
 * @param configPath - Path to write config.toml (defaults to ~/.onlyfence/config.toml)
 * @param force - Overwrite existing config if true
 * @returns The path to the created config file
 * @throws Error if the config already exists and force is false
 */
export function initConfig(configPath: string = CONFIG_PATH, force: boolean = false): string {
  mkdirSync(dirname(configPath), { recursive: true });

  const defaultConfig = createDefaultConfig();
  const tomlContent = serializeToToml(defaultConfig as unknown as Record<string, unknown>, [
    'OnlyFence Configuration',
    'See https://github.com/seallabs/onlyfence for documentation',
  ]);

  if (force) {
    writeFileSync(configPath, tomlContent, 'utf-8');
  } else {
    try {
      // Atomic create-if-not-exists: 'wx' flag fails if the file already exists,
      // avoiding a TOCTOU race between existsSync and writeFileSync.
      writeFileSync(configPath, tomlContent, { encoding: 'utf-8', flag: 'wx' });
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'EEXIST'
      ) {
        throw new ConfigAlreadyExistsError(configPath);
      }
      throw err;
    }
  }

  return configPath;
}
