import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { runStartupChecks } from '../../security/startup-checks.js';

describe('runStartupChecks', () => {
  it('returns no warnings for a properly secured directory', () => {
    const dir = join(tmpdir(), `fence-test-${randomBytes(4).toString('hex')}`);
    mkdirSync(dir, { mode: 0o700 });
    writeFileSync(join(dir, 'keystore'), 'test', { mode: 0o600 });
    writeFileSync(join(dir, 'config.toml'), 'test', { mode: 0o600 });
    writeFileSync(join(dir, 'trades.db'), 'test', { mode: 0o600 });

    const warnings = runStartupChecks(dir);
    // May have writable install dir warning, but no file permission warnings
    const fileWarnings = warnings.filter((w) => w.code === 'FILE_PERMISSIONS');
    expect(fileWarnings).toHaveLength(0);
  });

  it('warns about world-readable sensitive files', () => {
    const dir = join(tmpdir(), `fence-test-${randomBytes(4).toString('hex')}`);
    mkdirSync(dir, { mode: 0o700 });
    writeFileSync(join(dir, 'keystore'), 'test', { mode: 0o644 });

    const warnings = runStartupChecks(dir);
    const fileWarning = warnings.find(
      (w) => w.code === 'FILE_PERMISSIONS' && w.message.includes('keystore'),
    );
    expect(fileWarning).toBeDefined();
    expect(fileWarning?.fix).toContain('chmod 600');
  });

  it('warns about group-accessible data directory', () => {
    const dir = join(tmpdir(), `fence-test-${randomBytes(4).toString('hex')}`);
    mkdirSync(dir, { mode: 0o755 });

    const warnings = runStartupChecks(dir);
    const dirWarning = warnings.find((w) => w.code === 'DATA_DIR_PERMISSIONS');
    expect(dirWarning).toBeDefined();
  });

  it('returns empty for non-existent directory', () => {
    const warnings = runStartupChecks('/tmp/nonexistent-fence-dir-' + Date.now());
    // Only the data dir warning should be absent (dir doesn't exist)
    const dirWarning = warnings.find((w) => w.code === 'DATA_DIR_PERMISSIONS');
    expect(dirWarning).toBeUndefined();
  });
});
