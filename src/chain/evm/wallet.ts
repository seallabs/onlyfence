import { Wallet as EthersWallet, type providers as ethersProviders } from 'ethers';
import { createWalletClient, http, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { privateKeyHexFromBytes } from './derivation.js';

/**
 * Bundle of EVM chain clients backed by a single shared transport.
 *
 * The viem `publicClient` and ethers v5 `ethersProvider` are created
 * once at module load and reused across the adapter, Aave Pool, and
 * every action builder — avoiding duplicate HTTP connection pools and
 * divergent chain/block/nonce caches between the two SDKs.
 */
export interface EvmWalletContext {
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  readonly account: PrivateKeyAccount;
  readonly ethersProvider: ethersProviders.JsonRpcProvider;
  readonly ethersSigner: EthersWallet;
}

/** Parameters for building an `EvmWalletContext` from shared RPC clients. */
export interface BuildEvmWalletContextParams {
  /** Shared viem PublicClient owned by the chain module. */
  readonly publicClient: PublicClient;
  /** Shared ethers v5 provider owned by the chain module. */
  readonly ethersProvider: ethersProviders.JsonRpcProvider;
  /** RPC URL used to build the viem WalletClient transport. */
  readonly rpcUrl: string;
  /** Raw 32-byte secp256k1 private key from the encrypted session. */
  readonly keyBytes: Uint8Array;
}

/**
 * Build an `EvmWalletContext` keyed to the caller's private key,
 * reusing the shared public client and ethers provider.
 */
export function buildEvmWalletContext(params: BuildEvmWalletContextParams): EvmWalletContext {
  const { publicClient, ethersProvider, rpcUrl, keyBytes } = params;
  if (keyBytes.length !== 32) {
    throw new Error(`EVM wallet expects 32-byte private key, got ${keyBytes.length}`);
  }
  const privateKeyHex = privateKeyHexFromBytes(keyBytes);
  const account = privateKeyToAccount(privateKeyHex);

  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http(rpcUrl),
  });

  const ethersSigner = new EthersWallet(privateKeyHex, ethersProvider);

  return {
    publicClient,
    walletClient,
    account,
    ethersProvider,
    ethersSigner,
  };
}
