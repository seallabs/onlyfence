import type { ChainId } from './action-types.js';

export interface ProtectedTransaction {
  readonly bytes: Uint8Array;
  readonly metadata: Record<string, unknown>;
}

export interface MevProtector {
  readonly name: string;
  protect(txBytes: Uint8Array, chainId: ChainId): Promise<ProtectedTransaction>;
}

export class NoOpMevProtector implements MevProtector {
  readonly name = 'noop';

  protect(txBytes: Uint8Array, _chainId: ChainId): Promise<ProtectedTransaction> {
    return Promise.resolve({ bytes: txBytes, metadata: {} });
  }
}
