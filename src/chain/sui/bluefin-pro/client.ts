import {
  AccountDataStream,
  BluefinProSdk,
  BluefinRequestSigner,
  makeSigner,
  type Account,
  type AccountFundingRateHistory,
  type AccountStreamMessage,
  type ActiveOrderUpdate,
  type CancelOrdersRequest,
  type ExchangeInfoResponse,
  type FundingRateEntry,
  type Market,
  type OpenOrderResponse,
  type OrderCancellationUpdate,
  type OrderParams,
  type Trade,
} from '@bluefin-exchange/pro-sdk';
import type { SuiClient } from '@mysten/sui/client';
import type { Keypair } from '@mysten/sui/cryptography';

export type {
  Account,
  AccountFundingRateHistory,
  ExchangeInfoResponse,
  FundingRateEntry,
  Market,
  OpenOrderResponse,
  Trade,
};

export interface OrderConfirmation {
  readonly status: 'confirmed' | 'rejected' | 'timeout';
  readonly orderHash?: string;
  readonly reason?: string;
}

const DEFAULT_ORDER_TIMEOUT_MS = 10_000;
export interface BluefinClientConfig {
  readonly network: 'mainnet' | 'testnet';
  readonly suiClient: SuiClient;
  /** Any Sui Keypair (Ed25519, Secp256k1, etc.) */
  readonly keypair: Keypair;
}

/**
 * Wraps the Bluefin Pro SDK with typed method wrappers, auth lifecycle,
 * and error normalization.
 */
export class BluefinClient {
  private readonly sdk: BluefinProSdk;
  private initialized = false;

  constructor(config: BluefinClientConfig) {
    // Cast through unknown to bridge CJS/ESM type boundary between
    // our @mysten/sui and the SDK's bundled version. The SDK re-exports
    // its own @mysten/sui types which are structurally identical but
    // nominally different, so we cast via unknown to satisfy both sides.
    const wallet = makeSigner(config.keypair as unknown as Parameters<typeof makeSigner>[0], false);
    const signer = new BluefinRequestSigner(wallet);
    this.sdk = new BluefinProSdk(
      signer,
      config.network,
      config.suiClient as unknown as ConstructorParameters<typeof BluefinProSdk>[2],
    );
  }

  /**
   * Ensure the SDK is initialized (authenticates and fetches exchange config).
   * Called automatically by all public methods — safe to call multiple times.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.sdk.initialize();
    this.initialized = true;
  }

  /** Get exchange info including all available markets. */
  async getExchangeInfo(): Promise<ExchangeInfoResponse> {
    await this.ensureInitialized();
    const response = await this.sdk.exchangeDataApi.getExchangeInfo();
    return response.data;
  }

  /** Get account details (balances, margin, positions). */
  async getAccountDetails(): Promise<Account> {
    await this.ensureInitialized();
    const response = await this.sdk.accountDataApi.getAccountDetails();
    return response.data;
  }

  /** Get open orders, optionally filtered by market symbol. */
  async getOpenOrders(symbol?: string): Promise<OpenOrderResponse[]> {
    await this.ensureInitialized();
    const response = await this.sdk.getOpenOrders(symbol);
    return response.data;
  }

  /** Get trade history, optionally filtered by market and time range. */
  async getTrades(params?: {
    symbol?: string;
    startTimeAtMillis?: number;
    endTimeAtMillis?: number;
    limit?: number;
  }): Promise<Trade[]> {
    await this.ensureInitialized();
    const response = await this.sdk.accountDataApi.getAccountTrades(
      params?.symbol,
      params?.startTimeAtMillis,
      params?.endTimeAtMillis,
      params?.limit,
    );
    return response.data;
  }

  /** Place an order on Bluefin Pro. */
  async createOrder(params: OrderParams): Promise<unknown> {
    await this.ensureInitialized();
    return this.sdk.createOrder(params);
  }

  /** Cancel orders by symbol and optional order hashes. */
  async cancelOrders(request: CancelOrdersRequest): Promise<void> {
    await this.ensureInitialized();
    await this.sdk.cancelOrder(request);
  }

  /**
   * Deposit USDC into the Bluefin margin bank (on-chain TX).
   * NOTE: Despite the SDK naming its param "amountE9", it actually expects
   * the token's native unit (e.g. 1e6 for 1 USDC with 6 decimals).
   */
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types
  async deposit(amountNative: string) {
    await this.ensureInitialized();
    return this.sdk.deposit(amountNative);
  }

  /** Withdraw from Bluefin margin bank (signed API call). */
  async withdraw(assetSymbol: string, amountE9: string): Promise<void> {
    await this.ensureInitialized();
    await this.sdk.withdraw(assetSymbol, amountE9);
  }

  /** Get exchange-level funding rate history for a market. */
  async getFundingRateHistory(params: {
    symbol: string;
    limit?: number;
    startTimeAtMillis?: number;
    endTimeAtMillis?: number;
    page?: number;
  }): Promise<FundingRateEntry[]> {
    await this.ensureInitialized();
    const response = await this.sdk.exchangeDataApi.getFundingRateHistory(
      params.symbol,
      params.limit,
      params.startTimeAtMillis,
      params.endTimeAtMillis,
      params.page,
    );
    return response.data;
  }

  /** Get account-level funding rate payment history. */
  async getAccountFundingRateHistory(params?: {
    limit?: number;
    page?: number;
    startTimeAtMillis?: number;
    endTimeAtMillis?: number;
  }): Promise<AccountFundingRateHistory> {
    await this.ensureInitialized();
    const response = await this.sdk.accountDataApi.getAccountFundingRateHistory(
      undefined,
      params?.limit,
      params?.page,
      params?.startTimeAtMillis,
      params?.endTimeAtMillis,
    );
    return response.data;
  }

  /** Update leverage for a market. */
  async updateLeverage(symbol: string, leverageE9: string): Promise<void> {
    await this.ensureInitialized();
    await this.sdk.updateLeverage(symbol, leverageE9);
  }

  /**
   * Open a scoped WebSocket, wait for it to connect, then call `onReady`
   * (where the caller places the order), and wait for an order confirmation
   * or rejection matching the given `clientOrderId`. The WebSocket is closed
   * as soon as a matching event arrives or the timeout expires.
   *
   * Note: OPEN status settles as `confirmed` at the WS level. The caller
   * is responsible for additional verification (e.g. HTTP poll) if needed,
   * since the exchange may async-cancel after OPEN.
   */
  async waitForOrderEvent(
    clientOrderId: string,
    onReady: () => Promise<void>,
    timeoutMs: number = DEFAULT_ORDER_TIMEOUT_MS,
  ): Promise<OrderConfirmation> {
    await this.ensureInitialized();

    return new Promise<OrderConfirmation>((resolve) => {
      let ws: { close(): void } | undefined;
      let settled = false;

      const closeWs = (): void => {
        if (ws === undefined) return;
        ws.close();
      };

      const settle = (result: OrderConfirmation): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        closeWs();
        resolve(result);
      };

      const timer = setTimeout(() => {
        settle({ status: 'timeout' });
      }, timeoutMs);

      const handler = (message: AccountStreamMessage): void => {
        if (message.event === 'AccountOrderUpdate') {
          const payload = message.payload as ActiveOrderUpdate | OrderCancellationUpdate;
          if (payload.clientOrderId !== clientOrderId) return;

          // Check cancellationReason first — it's the most specific signal
          if ('cancellationReason' in payload) {
            const cancellation = payload;
            settle({
              status: 'rejected',
              orderHash: cancellation.orderHash,
              reason: cancellation.cancellationReason,
            });
            return;
          }

          if ('status' in payload) {
            const active = payload;
            if (
              active.status === 'OPEN' ||
              active.status === 'PARTIALLY_FILLED_OPEN' ||
              active.status === 'FILLED'
            ) {
              settle({ status: 'confirmed', orderHash: active.orderHash });
            } else if (
              active.status === 'CANCELLED' ||
              active.status === 'PARTIALLY_FILLED_CANCELED' ||
              active.status === 'EXPIRED' ||
              active.status === 'PARTIALLY_FILLED_EXPIRED'
            ) {
              settle({ status: 'rejected', orderHash: active.orderHash, reason: active.status });
            }
          }
        }

        if (message.event === 'AccountCommandFailureUpdate') {
          const failure = message.payload as { reason: string };
          settle({ status: 'rejected', reason: failure.reason });
        }
      };

      // Phase 1: Connect WS, subscribe to order events, then call onReady
      this.sdk
        // eslint-disable-next-line @typescript-eslint/require-await
        .createAccountDataStreamListener(async (msg) => {
          handler(msg);
        })
        .then(async (socket) => {
          ws = socket;
          if (settled) {
            closeWs();
            return;
          }
          // Subscribe to order and command failure events (required per SDK example)
          socket.send(
            JSON.stringify({
              method: 'Subscribe',
              dataStreams: [
                AccountDataStream.AccountOrderUpdate,
                AccountDataStream.AccountCommandFailureUpdate,
              ],
            }),
          );
          // Phase 2: WS is connected and subscribed — NOW place the order
          await onReady();
        })
        .catch((err: unknown) => {
          const errMessage = err instanceof Error ? err.message : String(err);
          settle({ status: 'rejected', reason: `WebSocket connection failed: ${errMessage}` });
        });
    });
  }

  /** Dispose the SDK (cleanup). */
  async dispose(): Promise<void> {
    await this.sdk.dispose();
    this.initialized = false;
  }
}
