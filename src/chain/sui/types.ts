import type {
  DevInspectResults,
  DryRunTransactionBlockResponse,
  SuiTransactionBlockResponse,
} from '@mysten/sui/client';

export interface ISuiEvent {
  readonly type: string;
  readonly parsedJson: unknown;
}

export type SuiRawResponse =
  | SuiTransactionBlockResponse
  | DryRunTransactionBlockResponse
  | DevInspectResults;
