import { Hyperliquid } from 'hyperliquid';
import { privateKeyHexFromBytes } from '../derivation.js';

/**
 * Thin wrapper around the `hyperliquid` SDK that supplies the EVM
 * private key so the SDK can sign EIP-712 actions for its L1 exchange.
 */
export class HyperliquidClient {
  readonly sdk: Hyperliquid;

  constructor(keyBytes: Uint8Array, options?: { testnet?: boolean }) {
    if (keyBytes.length !== 32) {
      throw new Error(`Hyperliquid expects a 32-byte EVM private key, got ${keyBytes.length}.`);
    }
    this.sdk = new Hyperliquid({
      privateKey: privateKeyHexFromBytes(keyBytes),
      testnet: options?.testnet ?? false,
      enableWs: false,
    });
  }

  dispose(): Promise<void> {
    try {
      this.sdk.disconnect();
    } catch {
      // Some SDK versions throw when WS was never started.
    }
    return Promise.resolve();
  }
}
