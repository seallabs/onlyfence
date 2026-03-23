import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'smol-toml';
import type { AppConfig } from '../types/config.js';
import { validateConfig, createDefaultConfig, ConfigAlreadyExistsError } from './schema.js';
import { serializeToToml } from './serializer.js';
import { toErrorMessage } from '../utils/index.js';
import { CONFIG_FILE_HEADER } from './utils.js';
import { enforceFilePermissions, SECURE_DIR_MODE } from '../security/file-permissions.js';

/**
 * Default directory for OnlyFence configuration and data.
 * Override with ONLYFENCE_HOME env var for development/testing.
 */
export const ONLYFENCE_DIR = process.env['ONLYFENCE_HOME'] ?? join(homedir(), '.onlyfence');

/**
 * Default path to the TOML configuration file.
 */
export const CONFIG_PATH = join(ONLYFENCE_DIR, 'config.toml');

/**
 * Read a config file with a friendly error on missing file.
 */
function readConfigFile(configPath: string): string {
  try {
    return readFileSync(configPath, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      throw new Error(
        `Configuration file not found at "${configPath}". ` +
          `Run "fence config init" to create a default configuration.`,
      );
    }
    throw new Error(`Failed to read config at "${configPath}": ${toErrorMessage(err)}`);
  }
}

/**
 * Load and parse the OnlyFence configuration from disk.
 *
 * @param configPath - Path to config.toml (defaults to ~/.onlyfence/config.toml)
 * @returns Parsed and validated AppConfig
 * @throws Error if the file does not exist or is invalid
 */
export function loadConfig(configPath: string = CONFIG_PATH): AppConfig {
  const content = readConfigFile(configPath);

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
export function initConfig(configPath: string = CONFIG_PATH, force = false): string {
  mkdirSync(dirname(configPath), { recursive: true, mode: SECURE_DIR_MODE });

  const defaultConfig = createDefaultConfig();
  const tomlContent = serializeToToml(defaultConfig as unknown as Record<string, unknown>, [
    'OnlyFence Configuration',
    'See https://github.com/seallabs/onlyfence for documentation',
  ]);

  if (force) {
    writeFileSync(configPath, tomlContent, 'utf-8');
    enforceFilePermissions(configPath);
  } else {
    try {
      // Atomic create-if-not-exists: 'wx' flag fails if the file already exists,
      // avoiding a TOCTOU race between existsSync and writeFileSync.
      writeFileSync(configPath, tomlContent, { encoding: 'utf-8', flag: 'wx' });
      enforceFilePermissions(configPath);
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

/**
 * Read the current config file, apply mutations, validate, and write back.
 *
 * Consolidates the read-parse-mutate-validate-serialize-write pattern
 * shared by CLI `config set` and TUI policy editor.
 *
 * @param mutate - Callback to modify the raw parsed config object
 * @param configPath - Path to config.toml (defaults to ~/.onlyfence/config.toml)
 * @returns The validated AppConfig after mutation
 * @throws Error if the file doesn't exist, mutation produces invalid config, or write fails
 */
export function updateConfigFile(
  mutate: (raw: Record<string, unknown>) => void,
  configPath: string = CONFIG_PATH,
): AppConfig {
  const raw = parse(readConfigFile(configPath)) as Record<string, unknown>;
  mutate(raw);

  const validated = validateConfig(raw);
  const toml = serializeToToml(raw, CONFIG_FILE_HEADER);
  writeFileSync(configPath, toml, 'utf-8');
  enforceFilePermissions(configPath);

  return validated;
}
