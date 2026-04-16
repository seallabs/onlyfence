import { HDKey, hdKeyToAccount, privateKeyToAccount } from 'viem/accounts';

/** BIP-44 derivation path for EVM (secp256k1, coin type 60). */
export const EVM_DERIVATION_PATH = "m/44'/60'/0'/0/0" as const;

/** Result of deriving an EVM keypair. */
export interface DerivedEvmKeypair {
  readonly address: string;
  /** Raw 32-byte secp256k1 private key. */
  readonly secretKey: Uint8Array;
}

/**
 * Derive an EVM keypair from a BIP-39 seed at the standard MetaMask /
 * Ledger path. Uses viem's HD helpers so the same library that signs
 * transactions also computes the address — guaranteeing consistency.
 */
export function deriveEvmKeypair(seed: Buffer): DerivedEvmKeypair {
  const hdKey = HDKey.fromMasterSeed(new Uint8Array(seed));
  const account = hdKeyToAccount(hdKey, { path: EVM_DERIVATION_PATH });
  const privateKey = account.getHdKey().privateKey;
  if (privateKey === null) {
    throw new Error('Failed to derive EVM private key from seed');
  }
  return {
    address: account.address,
    secretKey: new Uint8Array(privateKey),
  };
}

/** Build an EVM keypair from a raw 32-byte secp256k1 private key. */
export function evmKeypairFromRawKey(rawSeed: Uint8Array): DerivedEvmKeypair {
  if (rawSeed.length !== 32) {
    throw new Error(`EVM private key must be 32 bytes, got ${rawSeed.length}.`);
  }
  const account = privateKeyToAccount(privateKeyHexFromBytes(rawSeed));
  return {
    address: account.address,
    secretKey: rawSeed,
  };
}

/** 0x-prefixed hex encoding of a raw secp256k1 private key. */
export function privateKeyHexFromBytes(bytes: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

/** Parse a `0x`-prefixed or plain 64-char hex string into 32 raw bytes. */
export function hexToPrivateKeyBytes(hex: string): Uint8Array {
  const stripped = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (stripped.length !== 64) {
    throw new Error(
      `EVM private key must be 32 bytes (64 hex chars), got ${stripped.length} hex chars.`,
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(stripped)) {
    throw new Error('EVM private key contains invalid hex characters.');
  }
  return new Uint8Array(Buffer.from(stripped, 'hex'));
}
