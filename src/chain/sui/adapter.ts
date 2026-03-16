import type { ChainAdapter } from '../adapter.js';
import type {
  BalanceResult,
  SwapParams,
  SwapQuote,
  TransactionData,
  SimulationResult,
  TxResult,
  Signer,
} from '../../types/result.js';

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

  // TODO: Add these fields when implementing:
  // private readonly suiClient: SuiClient;
  // private readonly aggregatorBaseUrl: string;
  // private readonly rpcUrl: string;
  //
  // constructor(config: { rpcUrl: string; aggregatorBaseUrl?: string }) {
  //   this.suiClient = new SuiClient({ url: config.rpcUrl });
  //   this.aggregatorBaseUrl = config.aggregatorBaseUrl ?? 'https://api.7k.ag';
  //   this.rpcUrl = config.rpcUrl;
  // }

  /**
   * Query Sui RPC for native SUI balance and token balances.
   *
   * TODO: Implementation steps:
   * 1. Call suiClient.getBalance() for native SUI
   * 2. Call suiClient.getAllBalances() for all coin types
   * 3. Map coin types to known token symbols via SUI_TOKEN_MAP
   * 4. Return BalanceResult with all token balances and decimals
   */
  async getBalance(_address: string): Promise<BalanceResult> {
    throw new Error('SuiAdapter.getBalance not implemented');
  }

  /**
   * Fetch a swap quote from the 7K Aggregator API.
   *
   * TODO: Implementation steps:
   * 1. Resolve token symbols to coin type addresses via SUI_TOKEN_MAP
   * 2. Call 7K Aggregator API: GET /v1/quote with fromToken, toToken, amount, slippage
   * 3. Parse response for route, expectedOutput, priceImpact
   * 4. Return SwapQuote with protocol set to the aggregator's chosen DEX
   */
  async getSwapQuote(_params: SwapParams): Promise<SwapQuote> {
    throw new Error('SuiAdapter.getSwapQuote not implemented');
  }

  /**
   * Build an unsigned Programmable Transaction Block (PTB) from a swap quote.
   *
   * TODO: Implementation steps:
   * 1. Use the 7K Aggregator's build-tx endpoint or SDK to construct the PTB
   * 2. Serialize the TransactionBlock to bytes
   * 3. Attach chain metadata (coin types, amounts) for logging
   * 4. Return TransactionData with serialized bytes
   */
  async buildSwapTx(_quote: SwapQuote): Promise<TransactionData> {
    throw new Error('SuiAdapter.buildSwapTx not implemented');
  }

  /**
   * Dry-run a transaction against Sui RPC to validate before submission.
   *
   * TODO: Implementation steps:
   * 1. Deserialize TransactionData.bytes back into a TransactionBlock
   * 2. Call suiClient.dryRunTransactionBlock() with the transaction bytes
   * 3. Check the effects for success/failure status
   * 4. Extract gas cost estimate from the dry-run result
   * 5. Return SimulationResult with success status and gasEstimate
   */
  async simulateTx(_txData: TransactionData): Promise<SimulationResult> {
    throw new Error('SuiAdapter.simulateTx not implemented');
  }

  /**
   * Sign a transaction and submit it to the Sui network.
   *
   * TODO: Implementation steps:
   * 1. Deserialize TransactionData.bytes back into a TransactionBlock
   * 2. Sign the transaction bytes using the provided Signer
   * 3. Call suiClient.executeTransactionBlock() with signed bytes
   * 4. Wait for confirmation and extract the transaction digest
   * 5. Parse effects for actual gas used and output amounts
   * 6. Return TxResult with txDigest, status, gasUsed, and amountOut
   */
  async signAndSubmit(_txData: TransactionData, _signer: Signer): Promise<TxResult> {
    throw new Error('SuiAdapter.signAndSubmit not implemented');
  }
}
