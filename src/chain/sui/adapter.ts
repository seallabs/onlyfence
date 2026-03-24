import type {
  DevInspectResults,
  SuiJsonRpcClient,
  SuiTransactionBlockResponse,
} from '@mysten/sui/jsonRpc';
import type { Transaction } from '@mysten/sui/transactions';
import type { BalanceResult, Signer, SimulationResult, TxResult } from '../../types/result.js';
import type { ChainAdapter } from '../adapter.js';
import {
  getKnownDecimals,
  resolveTokenAddress,
  resolveSymbol as resolveTokenSymbol,
} from './tokens.js';

/** Default decimals for unknown Sui tokens. */
const DEFAULT_DECIMALS = 9;

/** Extract gas total from a GasCostSummary. */
function computeGas(gasUsed: {
  computationCost: string;
  storageCost: string;
  storageRebate: string;
}): number {
  return (
    Number(gasUsed.computationCost) + Number(gasUsed.storageCost) - Number(gasUsed.storageRebate)
  );
}

export type SuiTxResponse = SuiTransactionBlockResponse | DevInspectResults;

/**
 * Sui blockchain adapter implementing the ChainAdapter interface.
 *
 * Uses the JSON-RPC client from `@mysten/sui` for balance queries,
 * transaction simulation, and transaction submission.
 *
 * Constructor creates an owned `SuiJsonRpcClient` instance (no singleton).
 */
/** CAIP-2 chain identifier for Sui mainnet. */
export const SUI_CHAIN_ID = 'sui:mainnet' as const;

export class SuiAdapter implements ChainAdapter {
  readonly chain = 'sui' as const;
  readonly suiClient: SuiJsonRpcClient;
  readonly chainId = SUI_CHAIN_ID;

  constructor(client: SuiJsonRpcClient) {
    this.suiClient = client;
  }

  resolveTokenAddress(symbolOrAddress: string): string {
    return resolveTokenAddress(symbolOrAddress);
  }

  resolveTokenSymbol(coinType: string): string {
    return resolveTokenSymbol(coinType);
  }

  async getBalance(address: string): Promise<BalanceResult> {
    const balances = await this.suiClient.getAllBalances({ owner: address });

    return {
      address,
      balances: balances.map((b) => {
        const decimals = getKnownDecimals(b.coinType) ?? DEFAULT_DECIMALS;
        return {
          token: resolveTokenSymbol(b.coinType),
          amount: BigInt(b.totalBalance),
          decimals,
        };
      }),
    };
  }

  async buildTransactionBytes(transaction: Transaction): Promise<Uint8Array> {
    return transaction.build({ client: this.suiClient });
  }

  async simulate(txBytes: Uint8Array, _sender?: string): Promise<SimulationResult> {
    // Network/RPC errors propagate — only dry-run logic failures return { success: false }.
    const result = await this.suiClient.dryRunTransactionBlock({
      transactionBlock: txBytes,
    });

    const gasEstimate = computeGas(result.effects.gasUsed);

    if (result.effects.status.status === 'success') {
      return { success: true, gasEstimate, rawResponse: result };
    }

    return {
      success: false,
      gasEstimate,
      error: JSON.stringify(result.effects.status),
      rawResponse: result,
    };
  }

  async signAndSubmit(txBytes: Uint8Array, signer: Signer): Promise<TxResult> {
    const { signature } = await signer.signTransaction(txBytes);

    // Submit the transaction
    const result = await this.suiClient.executeTransactionBlock({
      transactionBlock: txBytes,
      signature,
      options: { showEffects: true, showEvents: true },
    });

    // effects may be null/undefined when showEffects is not returned
    const effects = result.effects;
    if (effects === null || effects === undefined) {
      return {
        txDigest: result.digest,
        status: 'failure',
        gasUsed: 0,
        rawResponse: result,
      };
    }

    return {
      txDigest: result.digest,
      status: effects.status.status === 'success' ? 'success' : 'failure',
      gasUsed: computeGas(effects.gasUsed),
      rawResponse: result,
    };
  }
}
