/**
 * Interface for fetching token price data from an external oracle.
 *
 * MVP uses a single oracle source. Post-MVP will support multiple
 * sources with fallback chains.
 */
export interface OracleClient {
  /**
   * Get the current USD price for a token.
   *
   * @param token - Token identifier (e.g., "SUI", "USDC")
   * @returns USD price as a number
   * @throws Error if the oracle is unreachable after retries
   */
  getPrice(token: string): Promise<number>;
}
