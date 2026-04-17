import { SwapSide } from '@paraswap/sdk';
import { erc20Abi, maxUint256, type Hex } from 'viem';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { SwapIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { EvmWalletContext } from '../wallet.js';
import { isEvmAddress, isNativeEth, type EvmAddress } from '../tokens.js';
import type { ParaswapClient } from './client.js';

/**
 * Paraswap's `TokenTransferProxy` on Ethereum mainnet. Hardcoded to
 * avoid an extra API round trip per swap — the address is stable and
 * only changes via Paraswap governance.
 */
const PARASWAP_TOKEN_TRANSFER_PROXY: EvmAddress = '0x216B4B4Ba9F3e719726886d34a177484278Bfcae';

/**
 * Paraswap Classic swap builder.
 *
 * Uses `off-chain-signed` because Paraswap returns a fully populated
 * transaction that the builder submits directly via viem.
 *
 * Flow: fetch quote + current allowance concurrently → submit approval
 * if needed → build swap tx → send swap tx → log.
 */
export class ParaswapSwapBuilder implements ActionBuilder<SwapIntent> {
  readonly builderId = 'paraswap-swap';
  readonly chain = 'ethereum';
  readonly executionStrategy = 'off-chain-signed' as const;

  constructor(
    private readonly paraswap: ParaswapClient,
    private readonly getWallet: () => EvmWalletContext,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: SwapIntent): void {
    const { coinTypeIn, coinTypeOut, amountIn } = intent.params;
    if (coinTypeIn === '' || coinTypeOut === '') {
      throw new Error('Missing EVM token addresses');
    }
    if (amountIn === '' || BigInt(amountIn) <= 0n) {
      throw new Error('Invalid swap amount');
    }
    if (coinTypeIn.toLowerCase() === coinTypeOut.toLowerCase()) {
      throw new Error('Cannot swap token to itself');
    }
    // By the time an intent reaches the builder the resolver has
    // already mapped aliases to addresses. Enforce this here so an
    // alias that slips through doesn't silently skip the approval.
    if (!isNativeEth(coinTypeIn) && !isEvmAddress(coinTypeIn)) {
      throw new Error(`Unresolved source token "${coinTypeIn}" — expected a 0x address`);
    }
    if (!isNativeEth(coinTypeOut) && !isEvmAddress(coinTypeOut)) {
      throw new Error(`Unresolved destination token "${coinTypeOut}" — expected a 0x address`);
    }
  }

  build(_intent: SwapIntent): Promise<BuiltTransaction> {
    return Promise.resolve({ transaction: null, metadata: {} });
  }

  async execute(intent: SwapIntent): Promise<{ metadata: Record<string, unknown> }> {
    const { coinTypeIn, coinTypeOut, amountIn, slippageBps } = intent.params;
    const wallet = this.getWallet();
    const userAddress = wallet.account.address;
    const amountInBigInt = BigInt(amountIn);

    // Quote and allowance lookup are independent — overlap them to
    // save one HTTP/RPC round trip per swap.
    const needsApproval = !isNativeEth(coinTypeIn);
    const srcTokenAddress = needsApproval ? (coinTypeIn as EvmAddress) : undefined;

    const [priceRoute, currentAllowance] = await Promise.all([
      this.paraswap.swap.getRate({
        srcToken: coinTypeIn,
        destToken: coinTypeOut,
        amount: amountIn,
        userAddress,
        side: SwapSide.SELL,
      }),
      srcTokenAddress !== undefined
        ? wallet.publicClient.readContract({
            address: srcTokenAddress,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [userAddress, PARASWAP_TOKEN_TRANSFER_PROXY],
          })
        : Promise.resolve<bigint>(maxUint256),
    ]);

    let approvalTxHash: Hex | undefined;
    if (srcTokenAddress !== undefined && currentAllowance < amountInBigInt) {
      approvalTxHash = await wallet.walletClient.writeContract({
        account: wallet.account,
        chain: wallet.walletClient.chain ?? null,
        address: srcTokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [PARASWAP_TOKEN_TRANSFER_PROXY, maxUint256],
      });
      await wallet.publicClient.waitForTransactionReceipt({ hash: approvalTxHash });
    }

    const txParams = await this.paraswap.swap.buildTx({
      srcToken: coinTypeIn,
      destToken: coinTypeOut,
      srcAmount: amountIn,
      slippage: slippageBps,
      priceRoute,
      userAddress,
    });

    const toAddress = txParams.to;
    if (!isEvmAddress(toAddress)) {
      throw new Error(`Paraswap returned non-address "to" field: ${toAddress}`);
    }

    // Pre-flight: ensure the wallet has enough ETH to cover value + gas cost.
    // Paraswap typically provides a gas estimate so eth_estimateGas is skipped
    // by viem — without this check, underfunded txs are silently dropped by
    // the mempool and waitForTransactionReceipt times out with no clear error.
    const txValue = BigInt(txParams.value);
    const gasLimit = txParams.gas !== undefined ? BigInt(txParams.gas) : 300_000n;
    const [ethBalance, gasPrice] = await Promise.all([
      wallet.publicClient.getBalance({ address: userAddress }),
      wallet.publicClient.getGasPrice(),
    ]);
    const gasCost = gasPrice * gasLimit;
    const totalRequired = txValue + gasCost;
    if (ethBalance < totalRequired) {
      const fmt = (n: bigint): string => `${(Number(n) / 1e18).toFixed(8)} ETH`;
      throw new Error(
        `Insufficient ETH: need ${fmt(totalRequired)} (${fmt(txValue)} value + ${fmt(gasCost)} gas), have ${fmt(ethBalance)}`,
      );
    }

    const txHash = await wallet.walletClient.sendTransaction({
      account: wallet.account,
      chain: wallet.walletClient.chain ?? null,
      to: toAddress,
      data: txParams.data as Hex,
      value: BigInt(txParams.value),
      ...(txParams.gas !== undefined ? { gas: BigInt(txParams.gas) } : {}),
    });

    const receipt = await wallet.publicClient.waitForTransactionReceipt({ hash: txHash });

    return {
      metadata: {
        txDigest: txHash,
        approvalTxHash,
        expectedOutput: priceRoute.destAmount,
        priceRoute: {
          gasCost: priceRoute.gasCost,
          srcAmount: priceRoute.srcAmount,
          destAmount: priceRoute.destAmount,
        },
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
      },
    };
  }

  finish(context: FinishContext): void {
    const intent = context.intent as SwapIntent;
    this.activityLog.logActivity({
      chain_id: intent.chainId,
      wallet_address: intent.walletAddress,
      action: 'trade:swap',
      protocol: 'paraswap',
      token_a_type: intent.params.coinTypeIn,
      token_a_amount: intent.params.amountIn,
      token_b_type: intent.params.coinTypeOut,
      token_b_amount: (context.metadata?.['expectedOutput'] as string | undefined) ?? undefined,
      value_usd: intent.tradeValueUsd ?? undefined,
      tx_digest:
        context.txDigest ?? (context.metadata?.['txDigest'] as string | undefined) ?? undefined,
      gas_cost: context.gasUsed ?? undefined,
      policy_decision: context.status,
      rejection_reason: context.rejection?.reason ?? undefined,
      rejection_check: context.rejection?.check ?? undefined,
    });
  }
}
