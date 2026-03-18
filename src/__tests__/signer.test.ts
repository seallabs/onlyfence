import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import nacl from 'tweetnacl';

// Generate a real keypair for test fixtures
const testKeypair = Ed25519Keypair.generate();
const testAddress = testKeypair.toSuiAddress();

// We need to mock loadKeystore before importing the module under test
vi.mock('../wallet/keystore.js', () => ({
  loadKeystore: vi.fn(),
}));

describe('resolveSuiSigner', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear relevant env vars before each test
    delete process.env['SUI_PRIVATE_KEY'];
    delete process.env['SUI_MNEMONIC'];
    delete process.env['SUI_DERIVATION_PATH'];
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('priority 1: resolves from SUI_PRIVATE_KEY env var', async () => {
    const exported = testKeypair.getSecretKey();
    process.env['SUI_PRIVATE_KEY'] = exported;

    const { resolveSuiSigner } = await import('../wallet/signer.js');
    const signer = resolveSuiSigner();

    expect(signer.address).toBe(testAddress);
    expect(signer.publicKey).toHaveLength(32);
    expect(signer.publicKey).toBeInstanceOf(Uint8Array);

    // Verify sign produces a valid Ed25519 signature (64 bytes)
    const data = new Uint8Array([1, 2, 3]);
    const sig = await signer.sign(data);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig).toHaveLength(64);
  });

  it('priority 2: resolves from SUI_MNEMONIC env var', async () => {
    const mnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    process.env['SUI_MNEMONIC'] = mnemonic;

    const { resolveSuiSigner } = await import('../wallet/signer.js');
    const signer = resolveSuiSigner();

    expect(signer.address).toMatch(/^0x[0-9a-f]{64}$/);
    expect(signer.publicKey).toHaveLength(32);
  });

  it('priority 1 takes precedence over priority 2', async () => {
    const exported = testKeypair.getSecretKey();
    process.env['SUI_PRIVATE_KEY'] = exported;
    process.env['SUI_MNEMONIC'] =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    const { resolveSuiSigner } = await import('../wallet/signer.js');
    const signer = resolveSuiSigner();

    // Should use private key, not mnemonic
    expect(signer.address).toBe(testAddress);
  });

  it('priority 3: resolves from encrypted keystore with 64-byte tweetnacl key', async () => {
    const { loadKeystore } = await import('../wallet/keystore.js');

    // Simulate what deriveSuiKeypair stores: 64-byte tweetnacl secretKey as hex
    // (32-byte seed + 32-byte public key)
    const seed = nacl.randomBytes(32);
    const naclKeypair = nacl.sign.keyPair.fromSeed(seed);
    // naclKeypair.secretKey is 64 bytes
    const hexKey = Buffer.from(naclKeypair.secretKey).toString('hex');

    // Derive the expected keypair using only the 32-byte seed
    const expectedKeypair = Ed25519Keypair.fromSecretKey(seed);
    const expectedAddress = expectedKeypair.toSuiAddress();

    vi.mocked(loadKeystore).mockReturnValue({
      keys: { sui: hexKey },
    });

    const { resolveSuiSigner } = await import('../wallet/signer.js');
    const signer = resolveSuiSigner('test-password');

    expect(loadKeystore).toHaveBeenCalledWith('test-password');
    expect(signer.address).toBe(expectedAddress);
    expect(signer.publicKey).toHaveLength(32);
  });

  it('throws when no signer source is available', async () => {
    const { resolveSuiSigner } = await import('../wallet/signer.js');

    expect(() => resolveSuiSigner()).toThrow(
      'No signer available. Set SUI_PRIVATE_KEY, SUI_MNEMONIC, or provide a keystore password.',
    );
  });

  it('throws when keystore has no sui key', async () => {
    const { loadKeystore } = await import('../wallet/keystore.js');
    vi.mocked(loadKeystore).mockReturnValue({
      keys: {},
    });

    const { resolveSuiSigner } = await import('../wallet/signer.js');

    expect(() => resolveSuiSigner('test-password')).toThrow('Keystore does not contain a Sui key');
  });
});
