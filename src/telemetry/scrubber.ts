import { SENSITIVE_KEY_SET, SENSITIVE_PATTERN_SOURCES } from '../logger/sensitive.js';

const REDACTED = '[REDACTED]';

/**
 * Recursively strip sensitive data from an arbitrary value.
 *
 * - Object keys matching SENSITIVE_KEY_SET are replaced with '[REDACTED]'.
 * - String values matching SENSITIVE_PATTERN_SOURCES are replaced with '[REDACTED]'.
 * - Arrays are recursively scrubbed element-by-element.
 * - Primitives (number, boolean, null) pass through unchanged.
 */
export function scrubSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return scrubString(data);
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => scrubSensitiveData(item));
  }

  const record = data as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_KEY_SET.has(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = scrubSensitiveData(value);
    }
  }

  return result;
}

function scrubString(value: string): string {
  let result = value;
  for (const src of SENSITIVE_PATTERN_SOURCES) {
    result = result.replace(new RegExp(src, 'g'), REDACTED);
  }
  return result;
}
