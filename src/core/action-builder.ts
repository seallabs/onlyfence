import type { ActionIntent } from './action-types.js';

export interface BuiltTransaction {
  readonly transaction: unknown;
  readonly metadata: Record<string, unknown>;
}

/**
 * Context passed to ActionBuilder.finish() after the pipeline completes
 * a loggable step (approval, rejection, or watch-only simulation).
 */
export interface FinishContext<Response = unknown> {
  readonly intent: ActionIntent;
  readonly status: 'approved' | 'rejected';
  readonly metadata?: Record<string, unknown>;
  readonly rawResponse?: Response;
  readonly txDigest?: string;
  readonly gasUsed?: number;
  readonly rejection?: {
    readonly check: string;
    readonly reason: string;
  };
}

export interface ActionBuilder<T extends ActionIntent = ActionIntent, R = unknown> {
  readonly builderId: string;
  readonly chain: string;
  validate(intent: T): void;
  build(intent: T): Promise<BuiltTransaction>;
  finish?(context: FinishContext<R>): void;
}
type BuilderKey = `${string}:${string}:${string}`;

function makeKey(chain: string, action: string, protocol: string): BuilderKey {
  return `${chain}:${action}:${protocol}`;
}

export class ActionBuilderRegistry {
  private readonly builders = new Map<BuilderKey, ActionBuilder>();
  private readonly factories = new Map<BuilderKey, (intent: ActionIntent) => ActionBuilder>();

  register(chain: string, action: string, protocol: string, builder: ActionBuilder): void {
    const key = makeKey(chain, action, protocol);
    if (this.builders.has(key) || this.factories.has(key)) {
      throw new Error(`ActionBuilderRegistry: key "${key}" is already registered`);
    }
    if (builder.chain !== chain) {
      throw new Error(
        `ActionBuilderRegistry: builder.chain "${builder.chain}" does not match registered chain "${chain}"`,
      );
    }
    this.builders.set(key, builder);
  }

  registerFactory(
    chain: string,
    action: string,
    protocol: string,
    factory: (intent: ActionIntent) => ActionBuilder,
  ): void {
    const key = makeKey(chain, action, protocol);
    if (this.builders.has(key) || this.factories.has(key)) {
      throw new Error(`ActionBuilderRegistry: key "${key}" is already registered`);
    }
    this.factories.set(key, factory);
  }

  get(chain: string, action: string, protocol: string, intent?: ActionIntent): ActionBuilder {
    const key = makeKey(chain, action, protocol);
    const builder = this.builders.get(key);
    if (builder !== undefined) return builder;

    const factory = this.factories.get(key);
    if (factory !== undefined) {
      if (intent === undefined) {
        throw new Error(
          `ActionBuilderRegistry: factory key "${key}" requires an intent to construct the builder`,
        );
      }
      const built = factory(intent);
      if (built.chain !== chain) {
        throw new Error(
          `ActionBuilderRegistry: factory-produced builder.chain "${built.chain}" does not match registered chain "${chain}"`,
        );
      }
      return built;
    }
    throw new Error(`ActionBuilderRegistry: no builder registered for key "${key}"`);
  }

  getDefault(chain: string, action: string, intent?: ActionIntent): ActionBuilder {
    const prefix = `${chain}:${action}:`;
    for (const [key, builder] of this.builders) {
      if (key.startsWith(prefix)) return builder;
    }
    for (const [key, factory] of this.factories) {
      if (key.startsWith(prefix)) {
        if (intent === undefined) {
          throw new Error(
            `ActionBuilderRegistry: factory key "${key}" requires an intent to construct the builder`,
          );
        }
        const built = factory(intent);
        if (built.chain !== chain) {
          throw new Error(
            `ActionBuilderRegistry: factory-produced builder.chain "${built.chain}" does not match registered chain "${chain}"`,
          );
        }
        return built;
      }
    }
    throw new Error(`ActionBuilderRegistry: no builder registered for "${chain}:${action}"`);
  }

  has(chain: string, action: string, protocol: string): boolean {
    const key = makeKey(chain, action, protocol);
    return this.builders.has(key) || this.factories.has(key);
  }
}
