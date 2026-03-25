import { describe, expect, it } from 'vitest';
import { buildSuiSigner } from '../chain/sui/signer.js';
import nacl from 'tweetnacl';

describe('buildSuiSigner', () => {
  it('builds signer from 32-byte seed', () => {
    const seed = nacl.randomBytes(32);
    const signer = buildSuiSigner(seed);

    expect(signer.address).toMatch(/^0x[0-9a-f]{64}$/);
    expect(signer.publicKey).toHaveLength(32);
    expect(signer.publicKey).toBeInstanceOf(Uint8Array);
  });

  it('builds signer from 64-byte tweetnacl key (extracts first 32 bytes as seed)', () => {
    const seed = nacl.randomBytes(32);
    const naclKeypair = nacl.sign.keyPair.fromSeed(seed);
    // naclKeypair.secretKey is 64 bytes (seed + pubkey)

    const signer = buildSuiSigner(naclKeypair.secretKey);

    // Should produce the same address as using just the 32-byte seed
    const signerFromSeed = buildSuiSigner(seed);
    expect(signer.address).toBe(signerFromSeed.address);
    expect(Buffer.from(signer.publicKey).toString('hex')).toBe(
      Buffer.from(signerFromSeed.publicKey).toString('hex'),
    );
  });

  it('signTransaction returns signature and bytes as strings', async () => {
    const seed = nacl.randomBytes(32);
    const signer = buildSuiSigner(seed);

    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await signer.signTransaction(data);

    expect(typeof result.signature).toBe('string');
    expect(typeof result.bytes).toBe('string');
    expect(result.signature.length).toBeGreaterThan(0);
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it('signTransaction produces consistent results for same input', async () => {
    const seed = nacl.randomBytes(32);
    const signer = buildSuiSigner(seed);

    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const result1 = await signer.signTransaction(data);
    const result2 = await signer.signTransaction(data);

    expect(result1.signature).toBe(result2.signature);
    expect(result1.bytes).toBe(result2.bytes);
  });
});
