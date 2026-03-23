import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sanitizeEnvironment, DANGEROUS_ENV_VARS } from '../../security/env-sanitizer.js';

describe('sanitizeEnvironment', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save current values
    for (const key of DANGEROUS_ENV_VARS) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    // Restore saved values
    for (const key of DANGEROUS_ENV_VARS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('removes dangerous env vars that are set', () => {
    process.env['NODE_OPTIONS'] = '--inspect';
    process.env['LD_PRELOAD'] = '/tmp/evil.so';

    const removed = sanitizeEnvironment();

    expect(process.env['NODE_OPTIONS']).toBeUndefined();
    expect(process.env['LD_PRELOAD']).toBeUndefined();
    expect(removed).toContain('NODE_OPTIONS');
    expect(removed).toContain('LD_PRELOAD');
  });

  it('returns empty array when no dangerous vars are set', () => {
    for (const key of DANGEROUS_ENV_VARS) {
      delete process.env[key];
    }

    const removed = sanitizeEnvironment();
    expect(removed).toHaveLength(0);
  });

  it('does not affect safe env vars', () => {
    process.env['ONLYFENCE_HOME'] = '/tmp/test';
    process.env['NODE_OPTIONS'] = '--inspect';

    sanitizeEnvironment();

    expect(process.env['ONLYFENCE_HOME']).toBe('/tmp/test');
    delete process.env['ONLYFENCE_HOME'];
  });

  it('strips all dangerous vars in one call', () => {
    for (const key of DANGEROUS_ENV_VARS) {
      process.env[key] = 'evil-value';
    }

    const removed = sanitizeEnvironment();

    expect(removed).toHaveLength(DANGEROUS_ENV_VARS.length);
    for (const key of DANGEROUS_ENV_VARS) {
      expect(process.env[key]).toBeUndefined();
    }
  });
});
