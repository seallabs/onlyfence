export interface ProtectedTransaction {
  readonly bytes: Uint8Array;
  readonly metadata: Record<string, unknown>;
}

export interface MevProtector {
  readonly name: string;
  protect(txBytes: Uint8Array, chain: string): Promise<ProtectedTransaction>;
}

export class NoOpMevProtector implements MevProtector {
  readonly name = 'noop';

  protect(txBytes: Uint8Array, _chain: string): Promise<ProtectedTransaction> {
    return Promise.resolve({ bytes: txBytes, metadata: {} });
  }
}
