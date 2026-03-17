import { describe, expect, it, vi } from 'vitest';
import type { SwapIntent, ActionPreview } from '../core/action-types.js';
import type { ActionBuilder, BuiltTransaction } from '../core/action-builder.js';
import { ActionBuilderRegistry } from '../core/action-builder.js';

function makeBuilder(chain: string): ActionBuilder<SwapIntent> {
  return {
    builderId: `${chain}-swap-builder`,
    chain,
    validate: vi.fn(),
    preview: vi.fn<(intent: SwapIntent) => Promise<ActionPreview>>().mockResolvedValue({
      description: 'mock preview',
      expectedOutput: '100',
      provider: 'mock',
      buildData: null,
    }),
    build: vi
      .fn<(intent: SwapIntent, preview: ActionPreview) => Promise<BuiltTransaction>>()
      .mockResolvedValue({
        transaction: {},
        metadata: {},
      }),
  };
}

const SWAP_INTENT: SwapIntent = {
  chain: 'sui',
  action: 'swap',
  walletAddress: '0xabc',
  params: {
    coinTypeIn: '0x2::sui::SUI',
    coinTypeOut: '0xusdc',
    amountIn: '1000000',
    slippageBps: 50,
  },
};

describe('ActionBuilderRegistry', () => {
  it('register and get by exact key', () => {
    const registry = new ActionBuilderRegistry();
    const builder = makeBuilder('sui');
    registry.register('sui', 'swap', 'aftermath', builder);

    const result = registry.get('sui', 'swap', 'aftermath');
    expect(result).toBe(builder);
  });

  it('getDefault returns first registered', () => {
    const registry = new ActionBuilderRegistry();
    const builder1 = makeBuilder('sui');
    const builder2 = makeBuilder('sui');
    registry.register('sui', 'swap', 'aftermath', builder1);
    registry.register('sui', 'swap', 'cetus', builder2);

    const result = registry.getDefault('sui', 'swap');
    expect(result).toBe(builder1);
  });

  it('duplicate key throws with "already registered"', () => {
    const registry = new ActionBuilderRegistry();
    const builder = makeBuilder('sui');
    registry.register('sui', 'swap', 'aftermath', builder);

    expect(() => registry.register('sui', 'swap', 'aftermath', builder)).toThrow(
      'already registered',
    );
  });

  it('chain mismatch throws with "does not match"', () => {
    const registry = new ActionBuilderRegistry();
    const builder = makeBuilder('eth');

    expect(() => registry.register('sui', 'swap', 'aftermath', builder)).toThrow('does not match');
  });

  it('get missing key throws with "no builder registered for key"', () => {
    const registry = new ActionBuilderRegistry();

    expect(() => registry.get('sui', 'swap', 'aftermath')).toThrow('no builder registered for key');
  });

  it('getDefault missing throws with "no builder registered for"', () => {
    const registry = new ActionBuilderRegistry();

    expect(() => registry.getDefault('sui', 'swap')).toThrow('no builder registered for');
  });

  it('registerFactory with intent works', () => {
    const registry = new ActionBuilderRegistry();
    const builder = makeBuilder('sui');
    const factory = vi.fn().mockReturnValue(builder);
    registry.registerFactory('sui', 'swap', 'aftermath', factory);

    const result = registry.get('sui', 'swap', 'aftermath', SWAP_INTENT);
    expect(result).toBe(builder);
    expect(factory).toHaveBeenCalledWith(SWAP_INTENT);
  });

  it('registerFactory without intent throws with "requires an intent"', () => {
    const registry = new ActionBuilderRegistry();
    const factory = vi.fn().mockReturnValue(makeBuilder('sui'));
    registry.registerFactory('sui', 'swap', 'aftermath', factory);

    expect(() => registry.get('sui', 'swap', 'aftermath')).toThrow('requires an intent');
  });

  it('has returns true when registered', () => {
    const registry = new ActionBuilderRegistry();
    const builder = makeBuilder('sui');
    registry.register('sui', 'swap', 'aftermath', builder);

    expect(registry.has('sui', 'swap', 'aftermath')).toBe(true);
  });

  it('has returns false when not registered', () => {
    const registry = new ActionBuilderRegistry();

    expect(registry.has('sui', 'swap', 'aftermath')).toBe(false);
  });

  it('has returns true for factory-registered key', () => {
    const registry = new ActionBuilderRegistry();
    registry.registerFactory('sui', 'swap', 'aftermath', () => makeBuilder('sui'));

    expect(registry.has('sui', 'swap', 'aftermath')).toBe(true);
  });

  it('duplicate factory key throws with "already registered"', () => {
    const registry = new ActionBuilderRegistry();
    const factory = vi.fn().mockReturnValue(makeBuilder('sui'));
    registry.registerFactory('sui', 'swap', 'aftermath', factory);

    expect(() => registry.registerFactory('sui', 'swap', 'aftermath', factory)).toThrow(
      'already registered',
    );
  });

  it('register after factory with same key throws with "already registered"', () => {
    const registry = new ActionBuilderRegistry();
    const factory = vi.fn().mockReturnValue(makeBuilder('sui'));
    registry.registerFactory('sui', 'swap', 'aftermath', factory);

    const builder = makeBuilder('sui');
    expect(() => registry.register('sui', 'swap', 'aftermath', builder)).toThrow(
      'already registered',
    );
  });

  it('getDefault with factory and no intent throws with "requires an intent"', () => {
    const registry = new ActionBuilderRegistry();
    registry.registerFactory('sui', 'swap', 'aftermath', () => makeBuilder('sui'));

    expect(() => registry.getDefault('sui', 'swap')).toThrow('requires an intent');
  });

  it('getDefault with factory and intent works', () => {
    const registry = new ActionBuilderRegistry();
    const builder = makeBuilder('sui');
    const factory = vi.fn().mockReturnValue(builder);
    registry.registerFactory('sui', 'swap', 'aftermath', factory);

    const result = registry.getDefault('sui', 'swap', SWAP_INTENT);
    expect(result).toBe(builder);
    expect(factory).toHaveBeenCalledWith(SWAP_INTENT);
  });
});
