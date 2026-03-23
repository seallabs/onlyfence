import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { enforceFilePermissions, SECURE_FILE_MODE } from '../../security/file-permissions.js';

describe('enforceFilePermissions', () => {
  const tmpDir = join(tmpdir(), `fence-test-${randomBytes(4).toString('hex')}`);
  const tmpFile = join(tmpDir, 'test-file');

  afterEach(() => {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  });

  it('sets file to 0o600', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpFile, 'test', { mode: 0o644 });

    enforceFilePermissions(tmpFile);

    const mode = statSync(tmpFile).mode & 0o777;
    expect(mode).toBe(SECURE_FILE_MODE);
  });

  it('accepts custom mode', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpFile, 'test', { mode: 0o644 });

    enforceFilePermissions(tmpFile, 0o400);

    const mode = statSync(tmpFile).mode & 0o777;
    expect(mode).toBe(0o400);
  });

  it('throws for non-existent file', () => {
    expect(() => enforceFilePermissions('/tmp/nonexistent-fence-file')).toThrow();
  });
});
