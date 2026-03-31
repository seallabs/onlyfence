import type { ChainConfig } from '../types/config.js';

/**
 * Ensure the chain section exists in a raw config object and populate
 * defaults for a chain if not already configured.
 *
 * Shared by interactive setup, non-interactive setup, and TUI wizard.
 */
export function applyChainConfigDefaults(
  raw: Record<string, unknown>,
  chainName: string,
  defaults: ChainConfig,
  credentials?: Record<string, string>,
): void {
  if (raw['chain'] === undefined || typeof raw['chain'] !== 'object') {
    raw['chain'] = {};
  }
  const chainSection = raw['chain'] as Record<string, unknown>;
  if (chainSection[chainName] !== undefined) return;

  const entry: Record<string, unknown> = { rpc: defaults.rpc };
  if (defaults.network !== undefined) entry['network'] = defaults.network;
  if (defaults.allowlist !== undefined) {
    entry['allowlist'] = { tokens: [...defaults.allowlist.tokens] };
  }
  if (defaults.limits !== undefined) {
    entry['limits'] = { ...defaults.limits };
  }
  if (credentials !== undefined && Object.keys(credentials).length > 0) {
    entry['credentials'] = credentials;
  }
  chainSection[chainName] = entry;
}
