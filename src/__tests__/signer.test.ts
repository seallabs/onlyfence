import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../wallet/keystore.js', () => ({
  loadKeystore: vi.fn(),
}));

describe('loadChainKeyBytes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns raw key bytes when keystore contains the requested chain key', async () => {
    const { loadKeystore } = await import('../wallet/keystore.js');
    const hexKey = 'ab'.repeat(32); // 32 bytes as hex
    vi.mocked(loadKeystore).mockReturnValue({
      keys: { 'sui:mainnet': hexKey },
    });

    const { loadChainKeyBytes } = await import('../wallet/signer.js');
    const bytes = loadChainKeyBytes('sui:mainnet', 'test-password');

    expect(loadKeystore).toHaveBeenCalledWith('test-password');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(32);
    expect(Buffer.from(bytes).toString('hex')).toBe(hexKey);
  });

  it('returns 64-byte key bytes when keystore stores tweetnacl format', async () => {
    const { loadKeystore } = await import('../wallet/keystore.js');
    const hexKey = 'cd'.repeat(64); // 64 bytes as hex
    vi.mocked(loadKeystore).mockReturnValue({
      keys: { 'sui:mainnet': hexKey },
    });

    const { loadChainKeyBytes } = await import('../wallet/signer.js');
    const bytes = loadChainKeyBytes('sui:mainnet', 'test-password');

    expect(bytes).toHaveLength(64);
    expect(Buffer.from(bytes).toString('hex')).toBe(hexKey);
  });

  it('throws with descriptive error when chain key is missing', async () => {
    const { loadKeystore } = await import('../wallet/keystore.js');
    vi.mocked(loadKeystore).mockReturnValue({
      keys: {},
    });

    const { loadChainKeyBytes } = await import('../wallet/signer.js');

    expect(() => loadChainKeyBytes('sui:mainnet', 'test-password')).toThrow(
      'Keystore does not contain a key for chain "sui:mainnet"',
    );
  });

  it('propagates loadKeystore errors (wrong password)', async () => {
    const { loadKeystore } = await import('../wallet/keystore.js');
    vi.mocked(loadKeystore).mockImplementation(() => {
      throw new Error('Failed to decrypt keystore: wrong password or corrupted data.');
    });

    const { loadChainKeyBytes } = await import('../wallet/signer.js');

    expect(() => loadChainKeyBytes('sui:mainnet', 'bad-password')).toThrow(
      'Failed to decrypt keystore: wrong password or corrupted data.',
    );
  });
});
