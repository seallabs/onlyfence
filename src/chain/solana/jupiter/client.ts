/**
 * Shared HTTP client for all Jupiter REST APIs.
 *
 * Handles:
 * - Endpoint resolution (always api.jup.ag with required API key)
 * - Auth header injection (x-api-key)
 * - Exponential backoff on HTTP 429
 */

const JUPITER_BASE_URL = 'https://api.jup.ag';
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SwapOrderParams {
  readonly inputMint: string;
  readonly outputMint: string;
  readonly amount: string;
  readonly taker: string;
  readonly slippageBps?: number;
}

export interface SwapOrderResponse {
  readonly transaction: string; // base64 encoded
  readonly requestId: string;
  readonly outAmount: string;
  readonly priceImpactPct: string;
}

export interface SwapExecuteParams {
  readonly signedTransaction: string; // base64 encoded
  readonly requestId: string;
}

export interface SwapExecuteResponse {
  readonly signature: string;
}

export interface JupiterPriceResponse {
  readonly data: Record<
    string,
    {
      readonly id: string;
      readonly price: string;
    }
  >;
}

export class JupiterClient {
  private readonly headers: HeadersInit;

  constructor(apiKey: string) {
    this.headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    };
  }

  /**
   * Fetch with retry on HTTP 429 (rate limit) and 503 (transient server error).
   * Exponential backoff: 500ms, 1s, 2s.
   */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await fetch(url, init);
      if (res.status !== 429 && res.status !== 503) return res;
      await sleep(Math.pow(2, attempt) * 500);
    }
    throw new Error('Jupiter API rate limit or server error after retries');
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchWithRetry(`${JUPITER_BASE_URL}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jupiter API error (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchWithRetry(`${JUPITER_BASE_URL}${path}`, {
      method: 'GET',
      headers: this.headers,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jupiter API error (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  // ── Swap V2 ──────────────────────────────────────────────────────────

  async swapOrder(params: SwapOrderParams): Promise<SwapOrderResponse> {
    return this.post<SwapOrderResponse>('/swap/v2/order', {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      taker: params.taker,
      ...(params.slippageBps !== undefined ? { slippageBps: params.slippageBps } : {}),
    });
  }

  async swapExecute(params: SwapExecuteParams): Promise<SwapExecuteResponse> {
    return this.post<SwapExecuteResponse>('/swap/v2/execute', {
      signedTransaction: params.signedTransaction,
      requestId: params.requestId,
    });
  }

  // ── Price V2 ─────────────────────────────────────────────────────────

  async getPrices(mints: string[]): Promise<Record<string, number>> {
    if (mints.length === 0) return {};

    const ids = mints.join(',');
    const data = await this.get<JupiterPriceResponse>(`/price/v2?ids=${ids}`);

    const result: Record<string, number> = {};
    for (const [id, entry] of Object.entries(data.data)) {
      const price = parseFloat(entry.price);
      if (Number.isFinite(price)) {
        result[id] = price;
      }
    }
    return result;
  }
}
