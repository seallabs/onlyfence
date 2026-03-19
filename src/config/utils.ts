/**
 * Get a nested value from an object using a dot-notation key path.
 *
 * @param obj - The object to traverse
 * @param keyPath - Dot-separated key path (e.g., "chain.sui.limits")
 * @returns The value at the key path, or undefined if not found
 */
export function getNestedValue(obj: unknown, keyPath: string): unknown {
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
 * Validate that a key segment used in a dot-notation path is safe and
 * cannot be used to pollute Object.prototype or other prototypes.
 */
function isSafeKeySegment(segment: string): boolean {
  return segment !== '__proto__' && segment !== 'constructor' && segment !== 'prototype';
}

/**
 * Set a nested value on an object using a dot-notation key path.
 * Creates intermediate objects as needed.
 *
 * @param obj - The object to modify
 * @param keyPath - Dot-separated key path
 * @param value - The value to set
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  keyPath: string,
  value: unknown,
): void {
  const parts = keyPath.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part === undefined || part === '') {
      throw new Error(`Invalid key path: "${keyPath}"`);
    }
    if (!isSafeKeySegment(part)) {
      throw new Error(`Unsafe key segment "${part}" in key path: "${keyPath}"`);
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
  if (lastPart === undefined || lastPart === '') {
    throw new Error(`Invalid key path: "${keyPath}"`);
  }
  if (!isSafeKeySegment(lastPart)) {
    throw new Error(`Unsafe key segment "${lastPart}" in key path: "${keyPath}"`);
  }
  current[lastPart] = value;
}

/**
 * Header comments written to the top of config.toml.
 */
export const CONFIG_FILE_HEADER: readonly string[] = [
  'OnlyFence Configuration',
  'See https://github.com/seallabs/onlyfence for documentation',
];

/**
 * Parse a config value string into its appropriate type.
 * Supports: numbers, booleans, JSON arrays, and plain strings.
 *
 * @param value - The string value to parse
 * @returns The parsed value
 */
export function parseConfigValue(value: string): unknown {
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
