import type { MevProtector, ProtectedTransaction } from '../../core/mev-protector.js';

export class SuiNoOpMev implements MevProtector {
  readonly name = 'sui-noop';

  protect(txBytes: Uint8Array, _chain: string): Promise<ProtectedTransaction> {
    return Promise.resolve({ bytes: txBytes, metadata: {} });
  }
}
