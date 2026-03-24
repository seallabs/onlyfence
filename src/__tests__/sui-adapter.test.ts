import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Signer } from '../types/result.js';

// Mock @mysten/sui/jsonRpc before importing the adapter
const mockGetAllBalances = vi.fn();
const mockDryRunTransactionBlock = vi.fn();
const mockExecuteTransactionBlock = vi.fn();

vi.mock('@mysten/sui/jsonRpc', () => {
  return {
    SuiJsonRpcClient: class MockSuiJsonRpcClient {
      getAllBalances = mockGetAllBalances;
      dryRunTransactionBlock = mockDryRunTransactionBlock;
      executeTransactionBlock = mockExecuteTransactionBlock;
    },
  };
});

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let SuiAdapter: typeof import('../chain/sui/adapter.js').SuiAdapter;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let SuiJsonRpcClient: typeof import('@mysten/sui/jsonRpc').SuiJsonRpcClient;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../chain/sui/adapter.js');
  SuiAdapter = mod.SuiAdapter;
  const rpcMod = await import('@mysten/sui/jsonRpc');
  SuiJsonRpcClient = rpcMod.SuiJsonRpcClient;
});

/** Create a mock SuiJsonRpcClient instance for testing. */
function createMockClient() {
  return new SuiJsonRpcClient({
    url: 'https://rpc.example.com',
    network: 'mainnet',
  });
}

describe('SuiAdapter', () => {
  it('has chain set to "sui"', () => {
    const adapter = new SuiAdapter(createMockClient());
    expect(adapter.chain).toBe('sui');
  });

  it('exposes suiClient as a readonly property', () => {
    const client = createMockClient();
    const adapter = new SuiAdapter(client);
    expect(adapter.suiClient).toBe(client);
  });

  describe('getBalance', () => {
    it('maps coin types to symbols and returns balances', async () => {
      mockGetAllBalances.mockResolvedValue([
        {
          coinType: '0x2::sui::SUI',
          totalBalance: '5000000000',
          coinObjectCount: 1,
          lockedBalance: {},
        },
        {
          coinType:
            '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
          totalBalance: '1000000',
          coinObjectCount: 2,
          lockedBalance: {},
        },
      ]);

      const adapter = new SuiAdapter(createMockClient());
      const result = await adapter.getBalance('0x' + 'a'.repeat(64));

      expect(result.address).toBe('0x' + 'a'.repeat(64));
      expect(result.balances).toHaveLength(2);
      expect(result.balances[0]).toEqual({
        token: 'SUI',
        amount: 5000000000n,
        decimals: 9,
      });
      expect(result.balances[1]).toEqual({
        token: 'USDC',
        amount: 1000000n,
        decimals: 6,
      });
    });

    it('uses normalized coin type as token name for unknown tokens', async () => {
      const unknownCoinType = '0xabc123::foo::BAR';
      mockGetAllBalances.mockResolvedValue([
        {
          coinType: unknownCoinType,
          totalBalance: '100',
          coinObjectCount: 1,
          lockedBalance: {},
        },
      ]);

      const adapter = new SuiAdapter(createMockClient());
      const result = await adapter.getBalance('0x' + 'b'.repeat(64));

      // Unknown tokens return the normalized coin type address (not struct name)
      // to avoid false-positive ambiguity
      expect(result.balances[0]?.token).toContain('::foo::BAR');
      // Unknown tokens default to 9 decimals
      expect(result.balances[0]?.decimals).toBe(9);
    });

    it('propagates RPC errors', async () => {
      mockGetAllBalances.mockRejectedValue(new Error('RPC connection failed'));

      const adapter = new SuiAdapter(createMockClient());
      await expect(adapter.getBalance('0xabc')).rejects.toThrow('RPC connection failed');
    });
  });

  describe('buildTransactionBytes', () => {
    it('calls build on the transaction with the client', async () => {
      const mockBuild = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
      const fakeTx = { build: mockBuild };

      const adapter = new SuiAdapter(createMockClient());
      const bytes = await adapter.buildTransactionBytes(fakeTx);

      expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
      expect(mockBuild).toHaveBeenCalledWith({
        client: expect.anything(),
      });
    });
  });

  describe('simulate', () => {
    it('returns success with gas estimate on successful dry run', async () => {
      mockDryRunTransactionBlock.mockResolvedValue({
        effects: {
          status: { status: 'success' },
          gasUsed: {
            computationCost: '1000',
            storageCost: '500',
            storageRebate: '200',
          },
        },
      });

      const adapter = new SuiAdapter(createMockClient());
      const result = await adapter.simulate(new Uint8Array([1, 2]));

      expect(result.success).toBe(true);
      expect(result.gasEstimate).toBe(1300); // 1000 + 500 - 200
      expect(result.error).toBeUndefined();
    });

    it('returns failure with error for failed dry run', async () => {
      mockDryRunTransactionBlock.mockResolvedValue({
        effects: {
          status: { status: 'failure', error: 'InsufficientGas' },
          gasUsed: {
            computationCost: '0',
            storageCost: '0',
            storageRebate: '0',
          },
        },
      });

      const adapter = new SuiAdapter(createMockClient());
      const result = await adapter.simulate(new Uint8Array([1, 2]));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('re-throws network/RPC errors instead of catching them', async () => {
      mockDryRunTransactionBlock.mockRejectedValue(new Error('Network timeout'));

      const adapter = new SuiAdapter(createMockClient());
      await expect(adapter.simulate(new Uint8Array([1, 2]))).rejects.toThrow('Network timeout');
    });
  });

  describe('signAndSubmit', () => {
    it('signs and submits transaction', async () => {
      const publicKey = new Uint8Array(32).fill(0xcd);

      const signer: Signer = {
        address: '0x' + 'ff'.repeat(32),
        publicKey,
        signTransaction: vi.fn().mockResolvedValue({
          signature: 'mockSignatureBase64',
          bytes: 'mockBytesBase64',
        }),
      };

      mockExecuteTransactionBlock.mockResolvedValue({
        digest: 'txDigest123',
        effects: {
          status: { status: 'success' },
          gasUsed: {
            computationCost: '2000',
            storageCost: '1000',
            storageRebate: '300',
          },
        },
      });

      const adapter = new SuiAdapter(createMockClient());
      const txBytes = new Uint8Array([10, 20, 30]);
      const result = await adapter.signAndSubmit(txBytes, signer);

      expect(signer.signTransaction).toHaveBeenCalledTimes(1);
      expect(signer.signTransaction).toHaveBeenCalledWith(txBytes);
      expect(result.txDigest).toBe('txDigest123');
      expect(result.status).toBe('success');
      expect(result.gasUsed).toBe(2700); // 2000 + 1000 - 300

      const call = mockExecuteTransactionBlock.mock.calls[0] as unknown[];
      const args = call[0] as Record<string, unknown>;
      expect(args['signature']).toBe('mockSignatureBase64');
      expect(args['options']).toEqual({ showEffects: true, showEvents: true });
    });

    it('returns failure status when transaction fails', async () => {
      const signer: Signer = {
        address: '0xabc',
        publicKey: new Uint8Array(32),
        signTransaction: vi.fn().mockResolvedValue({
          signature: 'mockSig',
          bytes: 'mockBytes',
        }),
      };

      mockExecuteTransactionBlock.mockResolvedValue({
        digest: 'txFailed456',
        effects: {
          status: { status: 'failure', error: 'MoveAbort' },
          gasUsed: {
            computationCost: '500',
            storageCost: '100',
            storageRebate: '50',
          },
        },
      });

      const adapter = new SuiAdapter(createMockClient());
      const result = await adapter.signAndSubmit(new Uint8Array([1]), signer);

      expect(result.status).toBe('failure');
      expect(result.txDigest).toBe('txFailed456');
    });

    it('propagates RPC errors during submission', async () => {
      const signer: Signer = {
        address: '0xabc',
        publicKey: new Uint8Array(32),
        signTransaction: vi.fn().mockResolvedValue({
          signature: 'mockSig',
          bytes: 'mockBytes',
        }),
      };

      mockExecuteTransactionBlock.mockRejectedValue(new Error('RPC auth failed'));

      const adapter = new SuiAdapter(createMockClient());
      await expect(adapter.signAndSubmit(new Uint8Array([1]), signer)).rejects.toThrow(
        'RPC auth failed',
      );
    });
  });
});
