import { Contract as EthersContract, type providers } from 'ethers';
import { resolveTokenAddress } from '../tokens.js';

// ---------------------------------------------------------------------------
// Market ID resolver (used by LendingIntentResolver)
// ---------------------------------------------------------------------------

/**
 * Resolve an Aave V3 market id. Aave V3 keeps a single market per
 * underlying reserve per deployment, so the stable id is just the
 * canonical reserve address — aliases like `USDC` pass through the
 * token registry resolver.
 */
export function resolveAaveV3MarketId(
  coinType: string,
  explicitMarketId?: string,
): Promise<string> {
  if (explicitMarketId !== undefined && explicitMarketId !== '') {
    return Promise.resolve(explicitMarketId);
  }
  return Promise.resolve(resolveTokenAddress(coinType));
}

// ---------------------------------------------------------------------------
// Contract addresses (Aave V3 Ethereum mainnet)
// Source: https://docs.aave.com/developers/deployed-contracts/v3-mainnet/ethereum-mainnet
// ---------------------------------------------------------------------------

const AAVE_PROTOCOL_DATA_PROVIDER = '0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3';
const AAVE_V3_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';

// ---------------------------------------------------------------------------
// ABIs (minimal slices — only the functions we call)
// ---------------------------------------------------------------------------

const DATA_PROVIDER_ABI = [
  'function getAllReservesTokens() view returns (tuple(string symbol, address tokenAddress)[])',
  'function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)',
  'function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)',
  'function getUserReserveData(address asset, address user) view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)',
] as const;

const POOL_ABI = [
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
] as const;

// ---------------------------------------------------------------------------
// Typed contract interfaces (avoids index-signature bracket notation)
// ---------------------------------------------------------------------------

interface ReserveToken {
  readonly symbol: string;
  readonly tokenAddress: string;
}

interface ReserveConfigData {
  readonly decimals: { toString(): string };
  readonly ltv: { toString(): string };
  readonly liquidationThreshold: { toString(): string };
  readonly usageAsCollateralEnabled: boolean;
  readonly borrowingEnabled: boolean;
  readonly isActive: boolean;
  readonly isFrozen: boolean;
}

interface ReserveData {
  readonly totalAToken: { toString(): string };
  readonly totalStableDebt: { toString(): string };
  readonly totalVariableDebt: { toString(): string };
  readonly liquidityRate: { toString(): string };
  readonly variableBorrowRate: { toString(): string };
}

interface UserReserveData {
  readonly currentATokenBalance: { toString(): string };
  readonly currentStableDebt: { toString(): string };
  readonly currentVariableDebt: { toString(): string };
  readonly usageAsCollateralEnabled: boolean;
}

interface UserAccountData {
  readonly totalCollateralBase: { toString(): string };
  readonly totalDebtBase: { toString(): string };
  readonly availableBorrowsBase: { toString(): string };
  readonly ltv: { toString(): string };
  readonly healthFactor: { toString(): string };
}

interface IDataProvider {
  getAllReservesTokens(): Promise<ReserveToken[]>;
  getReserveConfigurationData(asset: string): Promise<ReserveConfigData>;
  getReserveData(asset: string): Promise<ReserveData>;
  getUserReserveData(asset: string, user: string): Promise<UserReserveData>;
}

interface IPool {
  getUserAccountData(user: string): Promise<UserAccountData>;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface AaveMarketInfo {
  readonly marketId: string;
  readonly coinType: string;
  readonly symbol: string;
  readonly supplyApr: number;
  readonly borrowApr: number;
  readonly ltv: number;
  readonly liquidationThreshold: number;
  readonly totalSupply: number;
  readonly totalBorrow: number;
  readonly availableLiquidity: number;
  readonly utilizationRate: number;
  readonly active: boolean;
}

export interface AaveMarketDetail extends AaveMarketInfo {
  readonly borrowingEnabled: boolean;
  readonly usageAsCollateralEnabled: boolean;
  readonly decimals: number;
}

export interface AavePositionInfo {
  readonly coinType: string;
  readonly symbol: string;
  readonly supplied: number;
  readonly variableDebt: number;
  readonly stableDebt: number;
  readonly usedAsCollateral: boolean;
}

export interface AavePortfolioInfo {
  readonly totalCollateralUsd: number;
  readonly totalDebtUsd: number;
  readonly availableBorrowsUsd: number;
  /** null when there is no debt (health factor is effectively infinite). */
  readonly healthFactor: number | null;
  readonly ltv: number;
  readonly positions: readonly AavePositionInfo[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert Aave ray (1e27) rate to APR percentage. */
function rayToAprPercent(ray: { toString(): string }): number {
  return (Number(BigInt(ray.toString())) / 1e27) * 100;
}

/** Convert Aave base unit (1e8) USD value to human-readable USD. */
function baseToUsd(base: { toString(): string }): number {
  return Number(BigInt(base.toString())) / 1e8;
}

// ---------------------------------------------------------------------------
// Data provider
// ---------------------------------------------------------------------------

/**
 * Thin wrapper around the Aave V3 on-chain data contracts.
 * Exposes typed methods for market listing, detail, and user portfolios.
 * All data is fetched live from the chain — no external API dependency.
 */
export class AaveV3DataProvider {
  private readonly dataProvider: IDataProvider;
  private readonly pool: IPool;

  constructor(provider: providers.Provider) {
    this.dataProvider = new EthersContract(
      AAVE_PROTOCOL_DATA_PROVIDER,
      DATA_PROVIDER_ABI,
      provider,
    ) as unknown as IDataProvider;
    this.pool = new EthersContract(AAVE_V3_POOL, POOL_ABI, provider) as unknown as IPool;
  }

  async fetchAllMarkets(): Promise<AaveMarketInfo[]> {
    const tokens = await this.dataProvider.getAllReservesTokens();
    const markets = await Promise.all(
      tokens.map((t) => this.buildMarketInfo(t.symbol, t.tokenAddress)),
    );
    return markets.filter((m): m is AaveMarketInfo => m !== null);
  }

  async fetchMarketDetail(coinType: string): Promise<AaveMarketDetail> {
    const tokens = await this.dataProvider.getAllReservesTokens();
    const token = tokens.find((t) => t.tokenAddress.toLowerCase() === coinType.toLowerCase());
    if (token === undefined) {
      throw new Error(
        `No Aave V3 market found for "${coinType}". ` +
          'Run "fence lend markets --chain ethereum" to see available markets.',
      );
    }

    const [config, data] = await Promise.all([
      this.dataProvider.getReserveConfigurationData(token.tokenAddress),
      this.dataProvider.getReserveData(token.tokenAddress),
    ]);

    const decimals = Number(config.decimals.toString());
    const scale = 10 ** decimals;
    const totalSupply = Number(BigInt(data.totalAToken.toString())) / scale;
    const totalBorrow =
      (Number(BigInt(data.totalVariableDebt.toString())) +
        Number(BigInt(data.totalStableDebt.toString()))) /
      scale;

    return {
      marketId: token.tokenAddress,
      coinType: token.tokenAddress,
      symbol: token.symbol,
      supplyApr: rayToAprPercent(data.liquidityRate),
      borrowApr: rayToAprPercent(data.variableBorrowRate),
      ltv: Number(config.ltv.toString()) / 100,
      liquidationThreshold: Number(config.liquidationThreshold.toString()) / 100,
      totalSupply,
      totalBorrow,
      availableLiquidity: Math.max(0, totalSupply - totalBorrow),
      utilizationRate: totalSupply > 0 ? totalBorrow / totalSupply : 0,
      active: config.isActive && !config.isFrozen,
      borrowingEnabled: config.borrowingEnabled,
      usageAsCollateralEnabled: config.usageAsCollateralEnabled,
      decimals,
    };
  }

  async fetchPortfolio(userAddress: string): Promise<AavePortfolioInfo> {
    const tokens = await this.dataProvider.getAllReservesTokens();

    const [accountData, userReserves] = await Promise.all([
      this.pool.getUserAccountData(userAddress),
      Promise.all(
        tokens.map(async (t) => {
          const userData = await this.dataProvider.getUserReserveData(t.tokenAddress, userAddress);
          return { token: t, userData };
        }),
      ),
    ]);

    // Filter to positions the user actually holds, then fetch decimals for those only
    const activeReserves = userReserves.filter(({ userData }) => {
      const supplied = BigInt(userData.currentATokenBalance.toString());
      const variableDebt = BigInt(userData.currentVariableDebt.toString());
      const stableDebt = BigInt(userData.currentStableDebt.toString());
      return supplied > 0n || variableDebt > 0n || stableDebt > 0n;
    });

    const positions = await Promise.all(
      activeReserves.map(async ({ token, userData }) => {
        const configData = await this.dataProvider.getReserveConfigurationData(token.tokenAddress);
        const scale = 10 ** Number(configData.decimals.toString());
        return {
          coinType: token.tokenAddress,
          symbol: token.symbol,
          supplied: Number(BigInt(userData.currentATokenBalance.toString())) / scale,
          variableDebt: Number(BigInt(userData.currentVariableDebt.toString())) / scale,
          stableDebt: Number(BigInt(userData.currentStableDebt.toString())) / scale,
          usedAsCollateral: userData.usageAsCollateralEnabled,
        };
      }),
    );

    // healthFactor is uint256 max when there is no debt — treat as null (infinite / safe)
    const hfRaw = BigInt(accountData.healthFactor.toString());
    const HF_MAX = BigInt(
      '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    );
    const healthFactor = hfRaw === HF_MAX ? null : Number(hfRaw) / 1e18;

    return {
      totalCollateralUsd: baseToUsd(accountData.totalCollateralBase),
      totalDebtUsd: baseToUsd(accountData.totalDebtBase),
      availableBorrowsUsd: baseToUsd(accountData.availableBorrowsBase),
      healthFactor,
      ltv: Number(accountData.ltv.toString()) / 100,
      positions,
    };
  }

  private async buildMarketInfo(
    symbol: string,
    tokenAddress: string,
  ): Promise<AaveMarketInfo | null> {
    try {
      const [config, data] = await Promise.all([
        this.dataProvider.getReserveConfigurationData(tokenAddress),
        this.dataProvider.getReserveData(tokenAddress),
      ]);

      const decimals = Number(config.decimals.toString());
      const scale = 10 ** decimals;
      const totalSupply = Number(BigInt(data.totalAToken.toString())) / scale;
      const totalBorrow =
        (Number(BigInt(data.totalVariableDebt.toString())) +
          Number(BigInt(data.totalStableDebt.toString()))) /
        scale;

      return {
        marketId: tokenAddress,
        coinType: tokenAddress,
        symbol,
        supplyApr: rayToAprPercent(data.liquidityRate),
        borrowApr: rayToAprPercent(data.variableBorrowRate),
        ltv: Number(config.ltv.toString()) / 100,
        liquidationThreshold: Number(config.liquidationThreshold.toString()) / 100,
        totalSupply,
        totalBorrow,
        availableLiquidity: Math.max(0, totalSupply - totalBorrow),
        utilizationRate: totalSupply > 0 ? totalBorrow / totalSupply : 0,
        active: config.isActive && !config.isFrozen,
      };
    } catch {
      return null;
    }
  }
}
