import type { Chain, ChainId } from '../core/action-types.js';
import type { BalanceResult, Signer, SimulationResult, TxResult } from '../types/result.js';

/**
 * Interface for chain-specific adapters that handle blockchain interactions.
 *
 * Each supported blockchain implements this interface to provide:
 * - Balance queries
 * - Transaction building, simulation, signing, and submission
 *
 * MVP: SuiAdapter (via 7K Aggregator)
 * Post-MVP: EvmAdapter, SvmAdapter
 */
export interface ChainAdapter {
  /** Short chain name used as config key and factory key (e.g., "sui", "ethereum") */
  readonly chain: Chain;

  /** CAIP-2 chain identifier for DB storage and diagnostics (e.g., "sui:mainnet", "eip155:1") */
  readonly chainId: ChainId;

  /**
   * Get token balances for an address.
   *
   * @param address - Wallet address to query
   * @returns Balance information including all token holdings
   */
  getBalance(address: string): Promise<BalanceResult>;

  /**
   * Build a transaction into serialized bytes.
   *
   * @param transaction - Chain-specific transaction object
   * @returns Serialized transaction bytes ready for simulation or signing
   */
  buildTransactionBytes(transaction: unknown): Promise<Uint8Array>;

  /**
   * Simulate (dry-run) a transaction without submitting it.
   *
   * @param txBytes - Serialized transaction bytes
   * @param sender - Address of the transaction sender
   * @returns Simulation result including success status and gas estimate
   */
  simulate(txBytes: Uint8Array, sender: string): Promise<SimulationResult>;

  /**
   * Sign and submit a transaction to the blockchain.
   *
   * @param txBytes - Serialized transaction bytes
   * @param signer - Signer with the private key
   * @returns Transaction result including digest, status, and gas used
   */
  signAndSubmit(txBytes: Uint8Array, signer: Signer): Promise<TxResult>;
}
