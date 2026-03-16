import type { Command } from 'commander';
import type { TradeIntent } from '../../types/intent.js';
import type { PolicyContext } from '../../policy/context.js';
import type { CheckResult } from '../../types/result.js';
import type { AppComponents } from '../bootstrap.js';
import { getPrimaryWallet } from '../../wallet/manager.js';
import { printJsonOutput } from '../output.js';
import type { SuccessResponse, RejectionResponse, ErrorResponse } from '../output.js';
import { toErrorMessage } from '../../utils/index.js';
import { REJECTED_BY_KEY } from '../../policy/check.js';

/**
 * Register the `fence swap` command on the given program.
 *
 * Flow per spec section 3:
 * 1. Parse args into TradeIntent
 * 2. Load wallet for chain
 * 3. Create PolicyContext
 * 4. Resolve USD price via oracle
 * 5. Run policy pipeline
 * 6. If rejected: output rejection JSON and exit
 * 7. If approved: call chain adapter for quote, simulate, sign, submit
 * 8. Log trade to SQLite
 * 9. Output success JSON
 */
export function registerSwapCommand(program: Command, getComponents: () => AppComponents): void {
  program
    .command('swap <fromToken> <toToken> <amount>')
    .description('Execute a swap with policy enforcement')
    .option('-s, --slippage <percent>', 'Slippage tolerance in percent', '0.5')
    .option('-c, --chain <chain>', 'Target chain', 'sui')
    .option('-o, --output <format>', 'Output format (json)', 'json')
    .action(
      async (
        fromToken: string,
        toToken: string,
        amountStr: string,
        options: {
          slippage: string;
          chain: string;
          output: string;
        },
      ) => {
        let components: AppComponents;
        try {
          components = getComponents();
        } catch (err: unknown) {
          const errorOutput: ErrorResponse = {
            status: 'error',
            message: toErrorMessage(err),
          };
          printJsonOutput(errorOutput);
          process.exitCode = 1;
          return;
        }

        const { db, config, oracle, policyRegistry, chainAdapterFactory, tradeLog } = components;
        const chain = options.chain;

        try {
          // Validate chain config exists
          const chainConfig = config.chain[chain];
          if (chainConfig === undefined) {
            throw new Error(
              `No configuration found for chain "${chain}". ` +
                `Available chains: ${Object.keys(config.chain).join(', ')}`,
            );
          }

          // Parse amount to bigint
          const amount = parseBigIntAmount(amountStr);

          // Get wallet address
          const wallet = getPrimaryWallet(db, chain);
          if (wallet === null) {
            throw new Error(
              `No primary wallet found for chain "${chain}". Run "fence setup" first.`,
            );
          }

          // Build TradeIntent
          const intent: TradeIntent = {
            chain,
            action: 'swap',
            fromToken: fromToken.toUpperCase(),
            toToken: toToken.toUpperCase(),
            amount,
            walletAddress: wallet.address,
          };

          // Resolve USD price from oracle (handle failure per spec section 10)
          let tradeValueUsd: number | undefined;
          try {
            const price = await oracle.getPrice(intent.fromToken);
            tradeValueUsd = Number(intent.amount) * price;
          } catch (err: unknown) {
            console.warn(
              `Warning: Oracle price unavailable for ${intent.fromToken}: ` +
                `${toErrorMessage(err)}. ` +
                `USD spending limits will not be enforced.`,
            );
            tradeValueUsd = undefined;
          }

          // Build policy context
          const policyCtx: PolicyContext = {
            config: chainConfig,
            db,
            oracle,
            tradeLog,
            ...(tradeValueUsd !== undefined ? { tradeValueUsd } : {}),
          };

          // Run policy pipeline
          const policyResult: CheckResult = await policyRegistry.evaluateAll(intent, policyCtx);

          if (policyResult.status === 'reject') {
            // Log rejection
            tradeLog.logTrade({
              chain: intent.chain,
              wallet_address: intent.walletAddress,
              action: intent.action,
              from_token: intent.fromToken,
              to_token: intent.toToken,
              amount_in: intent.amount.toString(),
              ...(tradeValueUsd !== undefined ? { value_usd: tradeValueUsd } : {}),
              policy_decision: 'rejected',
              ...(policyResult.reason !== undefined
                ? { rejection_reason: policyResult.reason }
                : {}),
              ...(policyResult.metadata?.[REJECTED_BY_KEY] !== undefined
                ? {
                    rejection_check:
                      typeof policyResult.metadata['rejectedBy'] === 'string'
                        ? policyResult.metadata['rejectedBy']
                        : 'unknown',
                  }
                : {}),
            });

            const rejectionOutput: RejectionResponse = {
              status: 'rejected',
              chain: intent.chain,
              action: intent.action,
              check:
                typeof policyResult.metadata?.[REJECTED_BY_KEY] === 'string'
                  ? policyResult.metadata[REJECTED_BY_KEY]
                  : 'unknown',
              reason: policyResult.reason ?? 'policy_rejected',
              detail: policyResult.detail ?? 'Trade rejected by policy engine',
              ...(policyResult.metadata !== undefined ? { metadata: policyResult.metadata } : {}),
            };

            printJsonOutput(rejectionOutput);
            process.exitCode = 1;
            return;
          }

          // Policy approved - attempt chain execution
          const adapter = chainAdapterFactory.get(chain);
          const slippage = parseFloat(options.slippage);

          const quote = await adapter.getSwapQuote({
            fromToken: intent.fromToken,
            toToken: intent.toToken,
            amount: intent.amount,
            slippage,
            walletAddress: intent.walletAddress,
          });

          const txData = await adapter.buildSwapTx(quote);
          const simResult = await adapter.simulateTx(txData);

          if (!simResult.success) {
            throw new Error(`Transaction simulation failed: ${simResult.error ?? 'unknown error'}`);
          }

          // For now, sign and submit requires a signer which needs keystore password
          // This is a placeholder - the SuiAdapter methods throw "not implemented"
          // In production, we would prompt for password, load keystore, and create signer
          const txResult = await adapter.signAndSubmit(txData, {
            address: intent.walletAddress,
            sign: (_data: Uint8Array): Promise<Uint8Array> => Promise.resolve(new Uint8Array(64)),
          });

          // Log approved trade
          tradeLog.logTrade({
            chain: intent.chain,
            wallet_address: intent.walletAddress,
            action: intent.action,
            from_token: intent.fromToken,
            to_token: intent.toToken,
            amount_in: intent.amount.toString(),
            ...(txResult.amountOut !== undefined
              ? { amount_out: txResult.amountOut.toString() }
              : {}),
            ...(tradeValueUsd !== undefined ? { value_usd: tradeValueUsd } : {}),
            tx_digest: txResult.txDigest,
            gas_cost: txResult.gasUsed,
            policy_decision: 'approved',
          });

          const successOutput: SuccessResponse = {
            status: 'success',
            chain: intent.chain,
            action: intent.action,
            txDigest: txResult.txDigest,
            fromToken: intent.fromToken,
            toToken: intent.toToken,
            amountIn: intent.amount.toString(),
            amountOut: txResult.amountOut?.toString() ?? '0',
            valueUsd: tradeValueUsd ?? null,
            gasCost: txResult.gasUsed,
            route: quote.route,
          };

          printJsonOutput(successOutput);
        } catch (err: unknown) {
          const errorOutput: ErrorResponse = {
            status: 'error',
            message: toErrorMessage(err),
          };
          printJsonOutput(errorOutput);
          process.exitCode = 1;
        }
      },
    );
}

/**
 * Parse a string amount to bigint. Supports integer and decimal notation.
 * Decimal values are truncated to integers (smallest unit).
 *
 * @param value - String representation of the amount
 * @returns Parsed bigint value
 * @throws Error if the value is not a valid number
 */
function parseBigIntAmount(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid amount "${value}": must be a positive number`);
  }

  // If it contains a decimal, truncate to integer
  const integerPart = trimmed.split('.')[0];
  if (integerPart === undefined || integerPart === '') {
    throw new Error(`Invalid amount "${value}": must be a positive number`);
  }
  return BigInt(integerPart);
}
