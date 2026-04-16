import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { Connection } from '@solana/web3.js';
import type { JupiterClient } from './client.js';
import { resolveSymbol } from '../tokens.js';

// ---------------------------------------------------------------------------
// Program IDs — on-chain constants, stable across SDK versions.
// ---------------------------------------------------------------------------

const LENDING_PROGRAM_ID = new PublicKey('jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9');

// ---------------------------------------------------------------------------
// PDA derivation — all addresses are deterministic from the underlying mint.
// No RPC calls required.
// ---------------------------------------------------------------------------

/**
 * Derive the fTokenMint PDA for a given underlying token mint.
 * Seeds: ["f_token_mint", mint] on LENDING_PROGRAM_ID.
 */
function deriveFTokenMintPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('f_token_mint'), mint.toBuffer()],
    LENDING_PROGRAM_ID,
  );
  return pda;
}

/**
 * Derive the lending account PDA for a given underlying token mint.
 * Seeds: ["lending", mint, fTokenMintPDA] on LENDING_PROGRAM_ID.
 */
function deriveLendingPDA(mint: PublicKey): PublicKey {
  const fTokenMintPDA = deriveFTokenMintPDA(mint);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('lending'), mint.toBuffer(), fTokenMintPDA.toBuffer()],
    LENDING_PROGRAM_ID,
  );
  return pda;
}

// ---------------------------------------------------------------------------
// Local type definitions mirroring SDK runtime shapes.
// ---------------------------------------------------------------------------

interface BNLike {
  toNumber(): number;
  isZero(): boolean;
  toString(): string;
}

/**
 * Decoded lending account from the Jupiter Lend program.
 * `tokenExchangePrice` is the stored (last-accrued) exchange rate between
 * fToken shares and the underlying token. Accurate enough for portfolio display.
 */
interface DecodedLendingAccount {
  readonly tokenExchangePrice: BNLike;
  readonly decimals: number;
}

/**
 * OverallTokenData returned by Liquidity.getOverallTokensData().
 * supplyRate is in FOUR_DECIMALS scale (10000 = 100%). APR% = value / 100.
 */
interface SdkOverallTokenData {
  readonly supplyRate: BNLike;
}

// ---------------------------------------------------------------------------
// Rate / precision constants (mirrors @jup-ag/lend-read internals).
// ---------------------------------------------------------------------------

/** Scale for exchange prices: 1e12. underlyingAssets = fTokenShares × price / PRECISION. */
const EXCHANGE_PRICES_PRECISION = 1_000_000_000_000n;

/** supplyRate scale: 10000 = 100%. APR% = supplyRate / 100. */
const SUPPLY_RATE_DIVISOR = 100;

// ---------------------------------------------------------------------------
// Public DTO interfaces
// ---------------------------------------------------------------------------

export interface JupiterLendPosition {
  readonly symbol: string;
  readonly mint: string;
  readonly suppliedAmount: number;
  readonly suppliedUsd: number;
  /** Supply APR as a percentage (e.g., 7.5 = 7.5%). */
  readonly supplyApr: number;
}

/**
 * Jupiter Lend Earn portfolio summary for a Solana wallet.
 *
 * Jupiter Lend Earn is supply-only — no borrowing, liquidation, or borrow limit.
 * Fields that don't apply are always 0 for compatibility with the shared interface.
 */
export interface JupiterLendPortfolioInfo {
  readonly netWorth: number;
  readonly totalSuppliedUsd: number;
  /** Always 0 — Jupiter Lend Earn is supply-only. */
  readonly totalBorrowedUsd: number;
  /** Always 0 — rewards compound into the exchange price, not claimable separately. */
  readonly rewardsToClaimUsd: number;
  /** USD-weighted average supply APR across all positions. */
  readonly netApr: number;
  /** Estimated daily earnings in USD. */
  readonly dailyEarnings: number;
  /** Always 0 — no borrowing. */
  readonly borrowLimitUsed: number;
  /** Always 0 — no liquidation risk. */
  readonly liquidationThreshold: number;
  readonly positions: JupiterLendPosition[];
}

const EMPTY_PORTFOLIO: JupiterLendPortfolioInfo = {
  netWorth: 0,
  totalSuppliedUsd: 0,
  totalBorrowedUsd: 0,
  rewardsToClaimUsd: 0,
  netApr: 0,
  dailyEarnings: 0,
  borrowLimitUsed: 0,
  liquidationThreshold: 0,
  positions: [],
};

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

/**
 * Fetch the user's Jupiter Lend Earn portfolio.
 *
 * Optimised to use 5–6 RPC calls total (vs. 1 + N×7 in the SDK's
 * getUserPositions):
 *
 *  Phase 1 (3 parallel):
 *    - getProgramAccounts — all jlToken markets
 *    - 2× getParsedTokenAccountsByOwner — all user token accounts (Token + Token-2022)
 *
 *  Phase 2 (pure computation):
 *    - Derive fTokenMintPDAs, intersect with user holdings → active markets
 *
 *  Phase 3 (3 parallel for active markets only):
 *    - getMultipleAccountsInfo — lending accounts (stored exchange price + decimals)
 *    - liquidity.getOverallTokensData — supply APR
 *    - getPrices — USD prices
 */
export async function fetchPortfolio(
  address: string,
  connection: Connection,
  jupiterClient: JupiterClient,
): Promise<JupiterLendPortfolioInfo> {
  const { Client } = await import('@jup-ag/lend-read');

  const client = new Client(connection);
  const userPublicKey = new PublicKey(address);

  // ── Phase 1: 3 parallel calls ──────────────────────────────────────────

  const [allMints, tokenAccounts, token2022Accounts] = await Promise.all([
    client.lending.getAllJlTokens(),
    connection.getParsedTokenAccountsByOwner(userPublicKey, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(userPublicKey, { programId: TOKEN_2022_PROGRAM_ID }),
  ]);

  // ── Phase 2: pure computation — find active markets ────────────────────

  // Map fTokenMintPDA → underlyingMint (all derivations are local, no RPC).
  const fTokenToUnderlying = new Map<string, PublicKey>(
    allMints.map((mint) => [deriveFTokenMintPDA(mint).toString(), mint]),
  );

  // Collect all user token accounts (both programs) and find fToken positions.
  interface ActivePosition {
    underlyingMint: PublicKey;
    fTokenBalance: bigint; // raw shares, smallest unit
  }

  const allUserAccounts = [...tokenAccounts.value, ...token2022Accounts.value];
  const activePositions: ActivePosition[] = [];

  for (const acct of allUserAccounts) {
    const info = (
      acct.account.data.parsed as { info: { mint: string; tokenAmount: { amount: string } } }
    ).info;
    const fTokenMintStr = info.mint;
    const underlying = fTokenToUnderlying.get(fTokenMintStr);
    if (underlying === undefined) continue;

    const rawAmount = BigInt(info.tokenAmount.amount);
    if (rawAmount === 0n) continue;

    activePositions.push({ underlyingMint: underlying, fTokenBalance: rawAmount });
  }

  if (activePositions.length === 0) return EMPTY_PORTFOLIO;

  const activeMints = activePositions.map((p) => p.underlyingMint);
  const activeLendingPDAs = activeMints.map(deriveLendingPDA);

  // ── Phase 3: 3 parallel calls for active markets only ─────────────────

  const [lendingAccountInfos, overallTokensData, prices] = await Promise.all([
    // Batch-fetch all lending accounts in a single RPC call.
    connection.getMultipleAccountsInfo(activeLendingPDAs),
    // Batch-fetch all liquidity market data (supply rates) in 1–2 calls.
    client.liquidity.getOverallTokensData(activeMints) as Promise<SdkOverallTokenData[]>,
    // Batch-price all underlying mints in one HTTP call.
    jupiterClient.getPrices(activeMints.map((m) => m.toString())),
  ]);

  // Decode lending accounts using the Anchor program coder.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const coder = (client.lending as any).program.coder;

  // ── Phase 4: pure computation ──────────────────────────────────────────

  const positions: JupiterLendPosition[] = [];

  for (let i = 0; i < activePositions.length; i++) {
    const position = activePositions[i];
    const accountInfo = lendingAccountInfos[i];
    const overallData = overallTokensData[i];

    if (position === undefined || accountInfo === null || accountInfo === undefined) continue;

    const { underlyingMint, fTokenBalance } = position;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const lending = coder.accounts.decode('lending', accountInfo.data) as DecodedLendingAccount;

    // underlyingAssets = fTokenShares × storedExchangePrice / 10^12
    // Uses stored price (updated on every deposit/withdraw) — accurate for portfolio display.
    const tokenExchangePrice = BigInt(lending.tokenExchangePrice.toString());
    const underlyingRaw = (fTokenBalance * tokenExchangePrice) / EXCHANGE_PRICES_PRECISION;
    const suppliedAmount = Number(underlyingRaw) / Math.pow(10, lending.decimals);

    const mintStr = underlyingMint.toString();
    const priceUsd = prices[mintStr] ?? 0;
    const suppliedUsd = suppliedAmount * priceUsd;

    const supplyApr =
      overallData !== undefined ? overallData.supplyRate.toNumber() / SUPPLY_RATE_DIVISOR : 0;

    positions.push({
      symbol: resolveSymbol(mintStr),
      mint: mintStr,
      suppliedAmount,
      suppliedUsd,
      supplyApr,
    });
  }

  if (positions.length === 0) return EMPTY_PORTFOLIO;

  const totalSuppliedUsd = positions.reduce((sum, p) => sum + p.suppliedUsd, 0);

  const netApr =
    totalSuppliedUsd === 0
      ? 0
      : positions.reduce((sum, p) => sum + p.supplyApr * p.suppliedUsd, 0) / totalSuppliedUsd;

  const dailyEarnings = (totalSuppliedUsd * netApr) / 36500;

  return {
    netWorth: totalSuppliedUsd,
    totalSuppliedUsd,
    totalBorrowedUsd: 0,
    rewardsToClaimUsd: 0,
    netApr,
    dailyEarnings,
    borrowLimitUsed: 0,
    liquidationThreshold: 0,
    positions,
  };
}
