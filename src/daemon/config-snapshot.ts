/**
 * Immutable config snapshot for the daemon.
 *
 * The daemon freezes its config at startup. Config changes on disk
 * have no effect until the daemon is restarted — there is no hot-reload.
 * This is a security feature: the user must review the config diff and
 * authenticate with their password via `fence restart`.
 */

import { createHash } from 'node:crypto';
import type { AppConfig } from '../types/config.js';

export class ConfigSnapshot {
  private readonly config: Readonly<AppConfig>;
  private readonly hash: string;

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
}

function computeHash(config: AppConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 12);
}
