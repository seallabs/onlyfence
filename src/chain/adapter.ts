import type {
  BalanceResult,
  SwapParams,
  SwapQuote,
  TransactionData,
  SimulationResult,
  TxResult,
  Signer,
} from '../types/result.js';

/**
 * Interface for chain-specific adapters that handle blockchain interactions.
 *
 * Each supported blockchain implements this interface to provide:
 * - Balance queries
 * - Swap quote fetching (via aggregators)
 * - Transaction building, simulation, signing, and submission
 *
 * MVP: SuiAdapter (via 7K Aggregator)
 * Post-MVP: EvmAdapter, SvmAdapter
 */
export interface ChainAdapter {
  /** Short chain name used as config key and factory key (e.g., "sui", "ethereum") */
  readonly chain: string;

  /** CAIP-2 chain identifier for DB storage and diagnostics (e.g., "sui:mainnet", "eip155:1") */
  readonly chainId: string;

  /**
   * Get token balances for an address.
   *
   * @param address - Wallet address to query
   * @returns Balance information including all token holdings
   */
  getBalance(address: string): Promise<BalanceResult>;

  /**
   * Fetch a swap quote from the chain's aggregator.
   *
   * @param params - Swap parameters including tokens, amount, slippage
   * @returns Swap quote with route, expected output, and price impact
   */
  getSwapQuote(params: SwapParams): Promise<SwapQuote>;

  /**
   * Build an unsigned transaction from a swap quote.
   *
   * @param quote - The swap quote to build a transaction for
   * @returns Serialized transaction data ready for simulation or signing
   */
  buildSwapTx(quote: SwapQuote): Promise<TransactionData>;

  /**
   * Simulate (dry-run) a transaction without submitting it.
   *
   * @param txData - The transaction to simulate
   * @returns Simulation result including success status and gas estimate
   */
  simulateTx(txData: TransactionData): Promise<SimulationResult>;

  /**
   * Sign and submit a transaction to the blockchain.
   *
   * @param txData - The transaction to sign and submit
   * @param signer - Signer with the private key
   * @returns Transaction result including digest, status, and gas used
   */
  signAndSubmit(txData: TransactionData, signer: Signer): Promise<TxResult>;
}
