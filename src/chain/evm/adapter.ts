import { erc20Abi, type PublicClient } from 'viem';
import type { BalanceResult, Signer, SimulationResult, TxResult } from '../../types/result.js';
import type { ChainAdapter } from '../adapter.js';
import {
  EVM_KNOWN_DECIMALS,
  EVM_NATIVE_ETH_ADDRESS,
  getKnownDecimals,
  isEvmAddress,
  isNativeEth,
  resolveSymbol,
  resolveTokenAddress,
  type EvmAddress,
} from './tokens.js';

/** CAIP-2 chain identifier for Ethereum mainnet. */
export const EVM_CHAIN_ID = 'ethereum:mainnet' as const;

const ETH_DECIMALS = 18;

/**
 * Raw tx lifecycle methods (`buildTransactionBytes`/`simulate`/`signAndSubmit`)
 * are intentionally unsupported: every EVM protocol (Paraswap, Aave,
 * Hyperliquid) ships its own pre-built sign-in-place path, so routing
 * opaque bytes through the adapter would require a generic-over-tx-envelope
 * layer covering legacy / EIP-1559 / L2 variants.
 */
const OFF_CHAIN_ONLY_ERROR = new Error(
  'EVM adapter uses off-chain-signed builders — buildTransactionBytes / simulate / signAndSubmit are not supported. ' +
    'Each EVM builder submits transactions directly via its own SDK client.',
);

/** Registered ERC-20 tokens (every token in the registry except native ETH). */
const REGISTERED_ERC20_ADDRESSES: readonly EvmAddress[] = Object.keys(EVM_KNOWN_DECIMALS)
  .filter((addr) => !isNativeEth(addr))
  .map((addr) => addr as EvmAddress);

/**
 * EVM (Ethereum mainnet) blockchain adapter.
 *
 * Handles token resolution and balance queries. Transaction submission
 * is delegated entirely to the action builders (off-chain-signed).
 */
export class EvmAdapter implements ChainAdapter {
  readonly chain = 'ethereum' as const;
  readonly chainId = EVM_CHAIN_ID;

  constructor(readonly publicClient: PublicClient) {}

  resolveTokenAddress(symbolOrAddress: string): string {
    return resolveTokenAddress(symbolOrAddress);
  }

  resolveTokenSymbol(tokenAddress: string): string {
    return resolveSymbol(tokenAddress);
  }

  /**
   * Fetch balances for native ETH plus every registered ERC-20 token.
   * Unknown tokens are skipped — full-wallet discovery would require an
   * external indexer (Alchemy, Covalent) which is out of scope here.
   */
  async getBalance(address: string): Promise<BalanceResult> {
    if (!isEvmAddress(address)) {
      throw new Error(`Invalid EVM address: "${address}"`);
    }

    const [ethBalance, erc20Amounts] = await Promise.all([
      this.publicClient.getBalance({ address }),
      Promise.all(REGISTERED_ERC20_ADDRESSES.map((token) => this.readErc20Balance(token, address))),
    ]);

    const balances: { token: string; amount: bigint; decimals: number }[] = [];

    if (ethBalance > 0n) {
      balances.push({
        token: resolveSymbol(EVM_NATIVE_ETH_ADDRESS),
        amount: ethBalance,
        decimals: ETH_DECIMALS,
      });
    }

    for (const [index, amount] of erc20Amounts.entries()) {
      if (amount === 0n) continue;
      const tokenAddress = REGISTERED_ERC20_ADDRESSES[index];
      if (tokenAddress === undefined) continue;
      balances.push({
        token: resolveSymbol(tokenAddress),
        amount,
        decimals: getKnownDecimals(tokenAddress) ?? 18,
      });
    }

    return { address, balances };
  }

  buildTransactionBytes(_transaction: unknown): Promise<Uint8Array> {
    return Promise.reject(OFF_CHAIN_ONLY_ERROR);
  }

  simulate(_txBytes: Uint8Array, _sender?: string): Promise<SimulationResult> {
    return Promise.reject(OFF_CHAIN_ONLY_ERROR);
  }

  signAndSubmit(_txBytes: Uint8Array, _signer: Signer): Promise<TxResult> {
    return Promise.reject(OFF_CHAIN_ONLY_ERROR);
  }

  private readErc20Balance(tokenAddress: EvmAddress, owner: EvmAddress): Promise<bigint> {
    return this.publicClient
      .readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [owner],
      })
      .then(
        (raw: unknown) => (typeof raw === 'bigint' ? raw : 0n),
        () => 0n,
      );
  }
}
