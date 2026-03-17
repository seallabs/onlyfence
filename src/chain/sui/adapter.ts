import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { toBase64 } from '@mysten/bcs';
import type { ChainAdapter } from '../adapter.js';
import type { BalanceResult, SimulationResult, TxResult, Signer } from '../../types/result.js';
import { resolveSymbol, getKnownDecimals } from './tokens.js';

/** Default decimals for unknown Sui tokens. */
const DEFAULT_DECIMALS = 9;

/** Ed25519 signature scheme flag byte used by Sui. */
const ED25519_SCHEME_FLAG = 0x00;

/** Length of a serialized Sui Ed25519 signature: 1 (flag) + 64 (sig) + 32 (pubkey). */
const SUI_ED25519_SIGNATURE_LENGTH = 97;

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

/**
 * Sui blockchain adapter implementing the ChainAdapter interface.
 *
 * Uses the JSON-RPC client from `@mysten/sui` for balance queries,
 * transaction simulation, and transaction submission.
 *
 * Constructor creates an owned `SuiJsonRpcClient` instance (no singleton).
 */
export class SuiAdapter implements ChainAdapter {
  readonly chain = 'sui' as const;
  private readonly client: SuiJsonRpcClient;

  constructor(rpcUrl: string, network: 'mainnet' | 'testnet' = 'mainnet') {
    this.client = new SuiJsonRpcClient({ url: rpcUrl, network });
  }

  async getBalance(address: string): Promise<BalanceResult> {
    const balances = await this.client.getAllBalances({ owner: address });

    return {
      address,
      balances: balances.map((b) => {
        const decimals = getKnownDecimals(b.coinType) ?? DEFAULT_DECIMALS;
        return {
          token: resolveSymbol(b.coinType),
          amount: BigInt(b.totalBalance),
          decimals,
        };
      }),
    };
  }

  async buildTransactionBytes(transaction: unknown): Promise<Uint8Array> {
    const tx = transaction as { build(opts: { client: SuiJsonRpcClient }): Promise<Uint8Array> };
    return tx.build({ client: this.client });
  }

  async simulate(txBytes: Uint8Array, _sender: string): Promise<SimulationResult> {
    // Network/RPC errors propagate — only dry-run logic failures return { success: false }.
    const result = await this.client.dryRunTransactionBlock({
      transactionBlock: txBytes,
    });

    const gasEstimate = computeGas(result.effects.gasUsed);

    if (result.effects.status.status === 'success') {
      return { success: true, gasEstimate };
    }

    return {
      success: false,
      gasEstimate,
      error: JSON.stringify(result.effects.status),
    };
  }

  async signAndSubmit(txBytes: Uint8Array, signer: Signer): Promise<TxResult> {
    // 1. Sign the transaction bytes
    const rawSignature = await signer.sign(txBytes);

    // 2. Construct Sui serialized signature:
    //    [Ed25519 flag, ...rawSig(64 bytes), ...publicKey(32 bytes)]
    const suiSignature = new Uint8Array(SUI_ED25519_SIGNATURE_LENGTH);
    suiSignature[0] = ED25519_SCHEME_FLAG;
    suiSignature.set(rawSignature, 1);
    suiSignature.set(signer.publicKey, 65);

    // 3. Base64-encode the signature
    const signatureBase64 = toBase64(suiSignature);

    // 4. Submit the transaction
    const result = await this.client.executeTransactionBlock({
      transactionBlock: txBytes,
      signature: signatureBase64,
      options: { showEffects: true },
    });

    // effects may be null/undefined when showEffects is not returned
    const effects = result.effects;
    if (effects === null || effects === undefined) {
      return {
        txDigest: result.digest,
        status: 'failure',
        gasUsed: 0,
      };
    }

    return {
      txDigest: result.digest,
      status: effects.status.status === 'success' ? 'success' : 'failure',
      gasUsed: computeGas(effects.gasUsed),
    };
  }
}
