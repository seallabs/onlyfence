import { createCipheriv, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionData } from '../wallet/types.js';

// Mock the config loader to control ONLYFENCE_DIR
const TEST_DIR = '/tmp/onlyfence-test-session';

vi.mock('../config/loader.js', () => ({
  ONLYFENCE_DIR: '/tmp/onlyfence-test-session',
}));

// Mock keystore to avoid real filesystem reads
vi.mock('../wallet/keystore.js', () => ({
  loadKeystore: vi.fn(),
}));

const LEGACY_SESSION_PATH = join(TEST_DIR, 'session');
const SUI_SESSION_PATH = join(TEST_DIR, 'session.sui-mainnet');

// We need to track fs calls
const mockWriteFileSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockStatSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockReaddirSync = vi.fn();

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
    statSync: (...args: unknown[]) => mockStatSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  };
});

describe('session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: empty directory (no per-chain session files)
    mockReaddirSync.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createSession', () => {
    it('creates a per-chain session file with valid structure', async () => {
      const { loadKeystore } = await import('../wallet/keystore.js');
      const keyHex = 'ab'.repeat(32);
      vi.mocked(loadKeystore).mockReturnValue({
        keys: { 'sui:mainnet': keyHex },
      });

      const { createSession } = await import('../wallet/session.js');
      createSession('sui:mainnet', 'test-password', 14400);

      expect(mockMkdirSync).toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalledTimes(1);

      const [path, content, options] = mockWriteFileSync.mock.calls[0] as [
        string,
        string,
        { encoding: string; mode: number },
      ];
      expect(path).toBe(SUI_SESSION_PATH);
      expect(options.mode).toBe(0o600);

      const sessionData = JSON.parse(content) as SessionData;
      expect(sessionData.version).toBe(1);
      expect(sessionData.chain).toBe('sui:mainnet');
      expect(sessionData.session_key).toHaveLength(64); // 32 bytes hex
      expect(sessionData.iv).toHaveLength(24); // 12 bytes hex
      expect(sessionData.tag).toHaveLength(32); // 16 bytes hex
      expect(sessionData.encrypted_blob.length).toBeGreaterThan(0);

      // Verify expires_at is approximately now + TTL
      const expiresAt = new Date(sessionData.expires_at).getTime();
      const expectedExpiry = Date.now() + 14400 * 1000;
      expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThan(5000); // within 5 seconds
    });

    it('encrypted blob can be decrypted back to original key bytes', async () => {
      const { loadKeystore } = await import('../wallet/keystore.js');
      const keyHex = 'ab'.repeat(32);
      vi.mocked(loadKeystore).mockReturnValue({
        keys: { 'sui:mainnet': keyHex },
      });

      const { createSession } = await import('../wallet/session.js');
      createSession('sui:mainnet', 'test-password');

      const content = mockWriteFileSync.mock.calls[0]![1] as string;
      const sessionData = JSON.parse(content) as SessionData;

      // Manually decrypt to verify
      const { createDecipheriv } = await import('node:crypto');
      const sessionKey = Buffer.from(sessionData.session_key, 'hex');
      const iv = Buffer.from(sessionData.iv, 'hex');
      const ciphertext = Buffer.from(sessionData.encrypted_blob, 'hex');
      const tag = Buffer.from(sessionData.tag, 'hex');

      const decipher = createDecipheriv('aes-256-gcm', sessionKey, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      expect(decrypted.toString('hex')).toBe(keyHex);
    });

    it('throws when password is wrong (propagated from loadKeystore)', async () => {
      const { loadKeystore } = await import('../wallet/keystore.js');
      vi.mocked(loadKeystore).mockImplementation(() => {
        throw new Error('Failed to decrypt keystore: wrong password or corrupted data.');
      });

      const { createSession } = await import('../wallet/session.js');

      expect(() => createSession('sui:mainnet', 'bad-password')).toThrow(
        'Failed to decrypt keystore: wrong password or corrupted data.',
      );
    });

    it('throws when chain key is missing in keystore', async () => {
      const { loadKeystore } = await import('../wallet/keystore.js');
      vi.mocked(loadKeystore).mockReturnValue({ keys: {} });

      const { createSession } = await import('../wallet/session.js');

      expect(() => createSession('sui:mainnet', 'test-password')).toThrow(
        'Keystore does not contain a key for chain "sui:mainnet"',
      );
    });
  });

  describe('loadSessionKeyBytes', () => {
    function makeSessionFile(overrides: Partial<SessionData> = {}): string {
      // Create a real encrypted session for testing
      const keyBytes = Buffer.from('ab'.repeat(32), 'hex');
      const sessionKey = randomBytes(32);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', sessionKey, iv);
      const ciphertext = Buffer.concat([cipher.update(keyBytes), cipher.final()]);
      const tag = cipher.getAuthTag();

      const session: SessionData = {
        version: 1,
        session_key: sessionKey.toString('hex'),
        encrypted_blob: ciphertext.toString('hex'),
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        chain: 'sui:mainnet',
        expires_at: new Date(Date.now() + 14400 * 1000).toISOString(),
        ...overrides,
      };
      return JSON.stringify(session);
    }

    it('returns correct key bytes from a valid per-chain session', async () => {
      // First call (per-chain path) succeeds
      mockReadFileSync.mockReturnValue(makeSessionFile());

      const { loadSessionKeyBytes } = await import('../wallet/session.js');
      const bytes = loadSessionKeyBytes('sui:mainnet');

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(bytes).toString('hex')).toBe('ab'.repeat(32));
    });

    it('falls back to legacy session path when per-chain path not found', async () => {
      const enoent = new Error('ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      // Per-chain path not found; legacy path returns valid session
      mockReadFileSync
        .mockImplementationOnce(() => {
          throw enoent;
        })
        .mockReturnValueOnce(makeSessionFile());

      const { loadSessionKeyBytes } = await import('../wallet/session.js');
      const bytes = loadSessionKeyBytes('sui:mainnet');

      expect(Buffer.from(bytes).toString('hex')).toBe('ab'.repeat(32));
    });

    it('throws when neither session file exists', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      mockReadFileSync.mockImplementation(() => {
        throw err;
      });

      const { loadSessionKeyBytes } = await import('../wallet/session.js');

      expect(() => loadSessionKeyBytes('sui:mainnet')).toThrow(
        'No active session. Unlock your wallet first: fence unlock',
      );
    });

    it('throws when session is expired', async () => {
      const expiredSession = makeSessionFile({
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
      mockReadFileSync.mockReturnValue(expiredSession);

      const { loadSessionKeyBytes } = await import('../wallet/session.js');

      expect(() => loadSessionKeyBytes('sui:mainnet')).toThrow('Session expired');
    });

    it('throws when chain does not match', async () => {
      mockReadFileSync.mockReturnValue(makeSessionFile({ chain: 'eth:mainnet' }));

      const { loadSessionKeyBytes } = await import('../wallet/session.js');

      expect(() => loadSessionKeyBytes('sui:mainnet')).toThrow(
        'Session was created for chain "eth:mainnet", but "sui:mainnet" was requested',
      );
    });

    it('throws when session file is corrupted JSON', async () => {
      mockReadFileSync.mockReturnValue('not-json{{{');

      const { loadSessionKeyBytes } = await import('../wallet/session.js');

      expect(() => loadSessionKeyBytes('sui:mainnet')).toThrow('corrupted: invalid JSON');
    });

    it('throws when session has invalid version', async () => {
      mockReadFileSync.mockReturnValue(makeSessionFile({ version: 99 }));

      const { loadSessionKeyBytes } = await import('../wallet/session.js');

      expect(() => loadSessionKeyBytes('sui:mainnet')).toThrow('Unsupported session version');
    });
  });

  describe('destroySession', () => {
    it('overwrites and deletes per-chain session files', async () => {
      mockReaddirSync.mockReturnValue([
        'session.sui-mainnet',
        'session.solana-mainnet',
        'config.toml',
      ]);
      mockStatSync.mockReturnValue({ size: 256 });

      const { destroySession } = await import('../wallet/session.js');
      destroySession();

      // All matching session files should be zeroed and deleted
      const deletedPaths = mockUnlinkSync.mock.calls.map((c) => c[0] as string);
      expect(deletedPaths).toContain(join(TEST_DIR, 'session.sui-mainnet'));
      expect(deletedPaths).toContain(join(TEST_DIR, 'session.solana-mainnet'));
      // non-session file should not be touched
      expect(deletedPaths).not.toContain(join(TEST_DIR, 'config.toml'));
    });

    it('also clears the legacy session file if it exists', async () => {
      mockReaddirSync.mockReturnValue([]);
      mockStatSync
        .mockImplementationOnce(() => ({ size: 128 })) // legacy session exists
        .mockReturnValue({ size: 0 });

      const { destroySession } = await import('../wallet/session.js');
      destroySession();

      const deletedPaths = mockUnlinkSync.mock.calls.map((c) => c[0] as string);
      expect(deletedPaths).toContain(LEGACY_SESSION_PATH);
    });

    it('is idempotent when no session exists', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      mockStatSync.mockImplementation(() => {
        throw err;
      });
      mockReaddirSync.mockReturnValue([]);

      const { destroySession } = await import('../wallet/session.js');

      // Should not throw
      expect(() => destroySession()).not.toThrow();
    });
  });

  describe('hasActiveSession', () => {
    it('returns true when a per-chain session exists and is valid', async () => {
      mockReaddirSync.mockReturnValue(['session.sui-mainnet']);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ expires_at: new Date(Date.now() + 14400 * 1000).toISOString() }),
      );

      const { hasActiveSession } = await import('../wallet/session.js');
      expect(hasActiveSession()).toBe(true);
    });

    it('returns true when the legacy session exists and is valid', async () => {
      mockReaddirSync.mockReturnValue([]);
      // First read is for legacy path
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ expires_at: new Date(Date.now() + 14400 * 1000).toISOString() }),
      );

      const { hasActiveSession } = await import('../wallet/session.js');
      expect(hasActiveSession()).toBe(true);
    });

    it('returns false when no session file exists', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      mockReaddirSync.mockReturnValue([]);
      mockReadFileSync.mockImplementation(() => {
        throw err;
      });

      const { hasActiveSession } = await import('../wallet/session.js');
      expect(hasActiveSession()).toBe(false);
    });

    it('returns false when all sessions are expired', async () => {
      mockReaddirSync.mockReturnValue(['session.sui-mainnet']);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ expires_at: new Date(Date.now() - 1000).toISOString() }),
      );

      const { hasActiveSession } = await import('../wallet/session.js');
      expect(hasActiveSession()).toBe(false);
    });

    it('never throws', async () => {
      mockReaddirSync.mockImplementation(() => {
        throw new Error('unexpected error');
      });

      const { hasActiveSession } = await import('../wallet/session.js');
      expect(() => hasActiveSession()).not.toThrow();
      expect(hasActiveSession()).toBe(false);
    });
  });
});
