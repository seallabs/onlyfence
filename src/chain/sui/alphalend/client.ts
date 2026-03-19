import { AlphalendClient } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';

export function createAlphaLendClient(
  suiClient: SuiClient,
  network: 'mainnet' | 'testnet' = 'mainnet',
): AlphalendClient {
  return new AlphalendClient(network, suiClient);
}
