/**
 * Sliding window rate limiter and connection tracker for the daemon socket server.
 */

/** Default: 30 requests per minute. */
const DEFAULT_MAX_REQUESTS_PER_MIN = 30;

/** Default: 5 concurrent connections. */
const DEFAULT_MAX_CONNECTIONS = 5;

/**
 * Sliding window rate limiter that tracks requests per source.
 */
export class RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = DEFAULT_MAX_REQUESTS_PER_MIN, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if a request from the given source is allowed.
   *
   * @returns true if allowed, false if rate limit exceeded
   */
  check(source: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(source);
    if (timestamps === undefined) {
      timestamps = [];
      this.windows.set(source, timestamps);
    }

    // Remove expired timestamps
    while (timestamps.length > 0 && (timestamps[0] ?? 0) < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxRequests) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /** Remove all tracked state for a source. */
  clear(source: string): void {
    this.windows.delete(source);
  }
}

/**
 * Tracks active connections and enforces a maximum concurrent count.
 */
export class ConnectionTracker {
  private count = 0;
  private readonly max: number;

  constructor(max: number = DEFAULT_MAX_CONNECTIONS) {
    this.max = max;
  }

  /**
   * Try to acquire a connection slot.
   *
   * @returns true if a slot was available, false if at capacity
   */
  acquire(): boolean {
    if (this.count >= this.max) return false;
    this.count++;
    return true;
  }

  /** Release a connection slot. */
  release(): void {
    if (this.count > 0) this.count--;
  }

  get activeConnections(): number {
    return this.count;
  }
}
