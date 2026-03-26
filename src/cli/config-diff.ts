/**
 * Config diff utility for comparing daemon's in-memory config against on-disk config.
 *
 * Used by `fence restart` and `fence start` to show users what will change
 * before they confirm with a password.
 */

import type { AppConfig } from '../types/config.js';
import { red, green, yellow } from './style.js';

export interface ConfigChange {
  readonly path: string;
  readonly type: 'added' | 'removed' | 'changed';
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

/**
 * Compute the diff between two configs as a flat list of changes.
 *
 * @param current - The daemon's currently active config
 * @param incoming - The on-disk config that would be applied
 * @returns List of changes (empty if configs are identical)
 */
export function computeConfigDiff(current: AppConfig, incoming: AppConfig): ConfigChange[] {
  const changes: ConfigChange[] = [];
  diffObjects(current, incoming, '', changes);
  return changes;
}

/**
 * Format a config diff for terminal display.
 *
 * @returns Formatted string ready to print, or empty string if no changes
 */
export function formatConfigDiff(changes: ConfigChange[]): string {
  if (changes.length === 0) return '';

  const lines: string[] = ['Config changes to apply:', ''];

  for (const change of changes) {
    switch (change.type) {
      case 'added':
        lines.push(green(`  + ${change.path} = ${formatValue(change.newValue)}`));
        break;
      case 'removed':
        lines.push(red(`  - ${change.path} = ${formatValue(change.oldValue)}`));
        break;
      case 'changed':
        lines.push(yellow(`  ~ ${change.path}`));
        lines.push(red(`      was: ${formatValue(change.oldValue)}`));
        lines.push(green(`      now: ${formatValue(change.newValue)}`));
        break;
    }
  }

  lines.push('');
  return lines.join('\n');
}

function diffObjects(
  current: unknown,
  incoming: unknown,
  prefix: string,
  changes: ConfigChange[],
): void {
  if (current === incoming) return;

  // Both are plain objects — recurse
  if (isPlainObject(current) && isPlainObject(incoming)) {
    const allKeys = new Set([...Object.keys(current), ...Object.keys(incoming)]);
    for (const key of allKeys) {
      const path = prefix.length > 0 ? `${prefix}.${key}` : key;
      const inCurrent = key in current;
      const inIncoming = key in incoming;

      if (inCurrent && !inIncoming) {
        changes.push({ path, type: 'removed', oldValue: current[key] });
      } else if (!inCurrent && inIncoming) {
        changes.push({ path, type: 'added', newValue: incoming[key] });
      } else {
        diffObjects(current[key], incoming[key], path, changes);
      }
    }
    return;
  }

  // Both are arrays — compare element-by-element, or as whole values
  if (Array.isArray(current) && Array.isArray(incoming)) {
    if (JSON.stringify(current) !== JSON.stringify(incoming)) {
      changes.push({ path: prefix, type: 'changed', oldValue: current, newValue: incoming });
    }
    return;
  }

  // Leaf values differ
  if (current !== incoming) {
    const type = current === undefined ? 'added' : incoming === undefined ? 'removed' : 'changed';
    changes.push({ path: prefix, type, oldValue: current, newValue: incoming });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(undefined)';
  if (typeof value === 'string') return `"${value}"`;
  return JSON.stringify(value);
}
