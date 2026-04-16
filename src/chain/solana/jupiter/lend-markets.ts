import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import { resolveSymbol } from '../tokens.js';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface JupiterEarnMarketInfo {
  readonly id: number;
  readonly earnToken: string;
  readonly assetMint: string;
  readonly symbol: string;
  readonly decimals: number;
  /** Supply APR as a percentage (e.g. 7.5 = 7.5%). */
  readonly supplyApr: number;
  readonly totalSupplied: number;
}

export interface JupiterEarnMarketDetail extends JupiterEarnMarketInfo {
  readonly rewardsApr: number;
}

// ---------------------------------------------------------------------------
// Internal SDK shapes
// ---------------------------------------------------------------------------

interface BNLike {
  toNumber(): number;
  toString(): string;
}

interface SdkOverallTokenData {
  readonly supplyRate: BNLike;
  readonly rewardsRate?: BNLike;
}

/** Shape of a decoded lending account. */
interface DecodedLending {
  readonly fTokenMint: PublicKey;
  readonly lendingId: number;
  readonly decimals: number;
  readonly tokenReservesLiquidity: PublicKey;
  readonly supplyPositionOnLiquidity: PublicKey;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** supplyRate scale: 10000 = 100%. APR% = supplyRate / 100. */
const SUPPLY_RATE_DIVISOR = 100;

function rateToApr(rate: BNLike): number {
  return rate.toNumber() / SUPPLY_RATE_DIVISOR;
}

// ---------------------------------------------------------------------------
// Market ID resolver (used by LendingIntentResolver for earn ops)
// ---------------------------------------------------------------------------

/**
 * Resolve a lending market ID for a given token on Jupiter Lend.
 *
 * For earn operations (supply / withdraw), the market ID is the asset mint
 * address — the SDK resolves the correct vault internally.
 * Borrow vault discovery is handled inside SolanaLendBorrowBuilder.
 */
export function resolveJupiterLendMarketId(
  coinType: string,
  explicitMarketId?: string,
): Promise<string> {
  if (explicitMarketId !== undefined && explicitMarketId !== '') {
    return Promise.resolve(explicitMarketId);
  }
  return Promise.resolve(coinType);
}

// ---------------------------------------------------------------------------
// Shared bulk fetch (avoids per-token RPC calls and 429 rate limits)
// ---------------------------------------------------------------------------

/**
 * Fetch all Jupiter Lend earn market data using batch RPC calls.
 *
 * Uses @jup-ag/lend-read to issue 3 parallel bulk calls:
 *   - lending.getAllJlTokens()       — all earn pool underlying mints
 *   - liquidity.getOverallTokensData() — APR for all markets
 *   - lending.program.account.lending.all() — decimals, IDs, totals
 *
 * Total: 3-4 RPC calls regardless of market count.
 */
async function fetchBulkMarketData(connection: Connection): Promise<JupiterEarnMarketInfo[]> {
  const { Client } = await import('@jup-ag/lend-read');
  const client = new Client(connection);

  const [allMints, allLendingAccounts] = await Promise.all([
    client.lending.getAllJlTokens(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    (client.lending as any).program.account.lending.all() as Promise<{ account: DecodedLending }[]>,
  ]);

  // Build mint → lending account map for O(1) lookup
  const lendingByFToken = new Map<string, DecodedLending>();
  for (const { account } of allLendingAccounts) {
    lendingByFToken.set(account.fTokenMint.toString(), account);
  }

  // Derive fTokenMint PDA for each underlying mint to look up the lending account.
  // The lending account has a `fTokenMint` field we can use for the reverse mapping.
  // allMints are the underlying mints; allLendingAccounts store per-market data.
  // Map underlying mint → lending account directly via index alignment.
  const mints = allMints.slice(0, allLendingAccounts.length);

  // Fetch APR data for all underlying mints in one batch call
  const overallData = await (client.liquidity.getOverallTokensData(mints) as Promise<
    SdkOverallTokenData[]
  >);

  const markets: JupiterEarnMarketInfo[] = [];

  for (let i = 0; i < mints.length; i++) {
    const mint = mints[i];
    if (mint === undefined) continue;

    // Find the lending account for this underlying mint by scanning fTokenMint
    // (each underlying mint maps to exactly one lending account)
    const lendingAccount = allLendingAccounts.find((la) => {
      // The lending account's mint field (underlying asset) matches
      return (la.account as unknown as { mint: PublicKey }).mint.equals(mint);
    });
    if (lendingAccount === undefined) continue;

    const la = lendingAccount.account as unknown as { mint: PublicKey } & DecodedLending;
    const rateData = overallData[i];
    const supplyApr = rateData !== undefined ? rateToApr(rateData.supplyRate) : 0;

    markets.push({
      id: la.lendingId,
      earnToken: la.fTokenMint.toString(),
      assetMint: mint.toString(),
      symbol: resolveSymbol(mint.toString()),
      decimals: la.decimals,
      supplyApr,
      totalSupplied: 0, // requires on-chain token supply — omitted to keep call count low
    });
  }

  return markets.sort((a, b) => a.id - b.id);
}

// ---------------------------------------------------------------------------
// Market listing (fence lend markets --chain solana)
// ---------------------------------------------------------------------------

/**
 * Fetch all Jupiter Lend earn markets.
 * Uses batch RPC calls — no per-token round-trips, no 429 risk.
 */
export async function fetchAllEarnMarkets(
  connection: Connection,
): Promise<JupiterEarnMarketInfo[]> {
  return fetchBulkMarketData(connection);
}

// ---------------------------------------------------------------------------
// Market detail (fence lend market <token> --chain solana)
// ---------------------------------------------------------------------------

/**
 * Fetch detailed info for a single Jupiter Lend earn market by asset mint address.
 *
 * Reuses the bulk fetch and adds the per-market rewards APR.
 * Throws if the asset mint is not a supported earn market.
 */
export async function fetchEarnMarketDetail(
  connection: Connection,
  assetMint: string,
): Promise<JupiterEarnMarketDetail> {
  const { Client } = await import('@jup-ag/lend-read');
  const client = new Client(connection);

  const [allMints, allLendingAccounts] = await Promise.all([
    client.lending.getAllJlTokens(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    (client.lending as any).program.account.lending.all() as Promise<{ account: DecodedLending }[]>,
  ]);

  const targetMint = new PublicKey(assetMint);
  const idx = allMints.findIndex((m) => m.equals(targetMint));

  if (idx === -1) {
    throw new Error(
      `No Jupiter Lend earn market for "${assetMint}". ` +
        'Run "fence lend markets --chain solana" to see available markets.',
    );
  }

  const overallData = await (client.liquidity.getOverallTokensData(allMints) as Promise<
    SdkOverallTokenData[]
  >);

  const lendingAccount = allLendingAccounts.find((la) =>
    (la.account as unknown as { mint: PublicKey }).mint.equals(targetMint),
  );

  const la = lendingAccount?.account as unknown as
    | ({ mint: PublicKey } & DecodedLending)
    | undefined;
  const rateData = overallData[idx];
  const supplyApr = rateData !== undefined ? rateToApr(rateData.supplyRate) : 0;
  const rewardsApr = rateData?.rewardsRate !== undefined ? rateToApr(rateData.rewardsRate) : 0;

  return {
    id: la?.lendingId ?? idx,
    earnToken: la?.fTokenMint.toString() ?? '',
    assetMint,
    symbol: resolveSymbol(assetMint),
    decimals: la?.decimals ?? 6,
    supplyApr,
    rewardsApr,
    totalSupplied: 0,
  };
}
