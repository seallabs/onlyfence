import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { buildSuiSigner } from '../chain/sui/signer.js';

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

  it('produces valid Ed25519 signatures (64 bytes)', async () => {
    const seed = nacl.randomBytes(32);
    const signer = buildSuiSigner(seed);

    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const signature = await signer.sign(data);

    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature).toHaveLength(64);
  });

  it('signature is verifiable with the public key', async () => {
    const seed = nacl.randomBytes(32);
    const signer = buildSuiSigner(seed);

    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const signature = await signer.sign(data);

    // Verify with tweetnacl
    const isValid = nacl.sign.detached.verify(data, signature, signer.publicKey);
    expect(isValid).toBe(true);
  });
});
