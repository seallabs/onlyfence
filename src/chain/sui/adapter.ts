import type { ChainAdapter } from '../adapter.js';
import type { BalanceResult, SimulationResult, TxResult, Signer } from '../../types/result.js';

/**
 * Sui blockchain adapter implementing the ChainAdapter interface.
 *
 * MVP integration uses:
 * - Sui RPC (via @mysten/sui) for balance queries, simulation, and tx submission
 * - 7K Aggregator API for swap routing and quote fetching
 *
 * This is currently a placeholder — all methods throw "not implemented" errors.
 * The structure is ready for drop-in implementation of each method.
 */
export class SuiAdapter implements ChainAdapter {
  readonly chain = 'sui' as const;

  getBalance(_address: string): Promise<BalanceResult> {
    return Promise.reject(new Error('SuiAdapter.getBalance not implemented'));
  }

  buildTransactionBytes(_transaction: unknown): Promise<Uint8Array> {
    return Promise.reject(new Error('SuiAdapter.buildTransactionBytes not implemented'));
  }

  simulate(_txBytes: Uint8Array, _sender: string): Promise<SimulationResult> {
    return Promise.reject(new Error('SuiAdapter.simulate not implemented'));
  }

  signAndSubmit(_txBytes: Uint8Array, _signer: Signer): Promise<TxResult> {
    return Promise.reject(new Error('SuiAdapter.signAndSubmit not implemented'));
  }
}
