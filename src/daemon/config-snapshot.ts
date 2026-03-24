/**
 * Immutable config snapshot for the daemon.
 *
 * The daemon freezes its config at startup. Config changes on disk
 * have no effect until an authenticated reload is performed.
 */

import { createHash } from 'node:crypto';
import { loadConfig, CONFIG_PATH } from '../config/loader.js';
import { loadKeystore } from '../wallet/keystore.js';
import type { AppConfig } from '../types/config.js';

export class ConfigSnapshot {
  private config: Readonly<AppConfig>;
  private hash: string;

  constructor(config: AppConfig) {
    this.config = Object.freeze(structuredClone(config));
    this.hash = computeHash(config);
  }

  /** Get the frozen config. */
  get current(): Readonly<AppConfig> {
    return this.config;
  }

  /** SHA-256 hash of the config for tamper detection. */
  get configHash(): string {
    return this.hash;
  }

  /**
   * Reload the config from disk after verifying the password.
   *
   * The password is verified by attempting to decrypt the keystore.
   * If decryption succeeds, the password is valid and the config is reloaded.
   *
   * @param password - The keystore password for authentication
   * @param configPath - Optional custom config path
   * @param keystorePath - Optional custom keystore path
   * @returns The new config hash
   * @throws Error if the password is wrong or the new config is invalid
   */
  reload(password: string, configPath?: string, keystorePath?: string): string {
    loadKeystore(password, keystorePath);
    const newConfig = loadConfig(configPath ?? CONFIG_PATH);
    this.config = Object.freeze(structuredClone(newConfig));
    this.hash = computeHash(newConfig);

    return this.hash;
  }
}

function computeHash(config: AppConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 12);
}
