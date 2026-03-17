import { parse } from 'smol-toml';
import { toErrorMessage } from '../utils/index.js';

/**
 * Serialize a config object to TOML format.
 *
 * Handles nested objects as TOML sections with dot-separated keys,
 * arrays as TOML arrays, and scalar values as TOML literals.
 *
 * @param obj - The config object to serialize
 * @param header - Optional comment lines to prepend (each without the leading #)
 * @returns Valid TOML string
 * @throws Error if the generated TOML fails round-trip validation
 */
export function serializeToToml(obj: Record<string, unknown>, header?: readonly string[]): string {
  const lines: string[] = [];

  if (header !== undefined) {
    for (const line of header) {
      lines.push(`# ${line}`);
    }
    lines.push('');
  }

  appendSection(lines, obj, '');

  const toml = lines.join('\n') + '\n';

  // Verify round-trip through smol-toml
  try {
    parse(toml);
  } catch (err) {
    throw new Error(`Generated TOML failed round-trip validation: ${toErrorMessage(err)}`);
  }

  return toml;
}

/**
 * Recursively append TOML sections and scalar values to the output lines.
 */
function appendSection(lines: string[], obj: Record<string, unknown>, prefix: string): void {
  // First pass: output scalar values at this level
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      continue;
    }
    lines.push(`${key} = ${formatTomlValue(value)}`);
  }

  // Second pass: output nested sections
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }

    const sectionKey = prefix !== '' ? `${prefix}.${key}` : key;
    lines.push('');
    lines.push(`[${sectionKey}]`);
    appendSection(lines, value as Record<string, unknown>, sectionKey);
  }
}

/**
 * Format a value as a TOML literal.
 */
function formatTomlValue(value: unknown): string {
  if (typeof value === 'string') {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => formatTomlValue(v)).join(', ');
    return `[${items}]`;
  }
  return String(value);
}
