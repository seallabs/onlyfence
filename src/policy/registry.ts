import type { PolicyCheck } from './check.js';
import { REJECTED_BY_KEY } from './check.js';
import type { PolicyContext } from './context.js';
import type { TradeIntent } from '../types/intent.js';
import type { CheckResult } from '../types/result.js';

/**
 * Registry that manages and executes an ordered pipeline of PolicyChecks.
 *
 * Checks are evaluated in registration order. The pipeline short-circuits
 * on the first rejection, returning that result immediately.
 */
export class PolicyCheckRegistry {
  private readonly checks: Map<string, PolicyCheck> = new Map();

  /**
   * Register a new policy check to the end of the pipeline.
   *
   * @param check - The PolicyCheck implementation to register
   * @throws Error if a check with the same name is already registered
   */
  register(check: PolicyCheck): void {
    if (this.checks.has(check.name)) {
      throw new Error(
        `PolicyCheck with name "${check.name}" is already registered. ` +
          `Each check must have a unique name.`,
      );
    }
    this.checks.set(check.name, check);
  }

  /**
   * Evaluate all registered checks against a trade intent.
   *
   * Checks run in registration order. Execution stops at the first
   * rejection, returning that CheckResult. If all checks pass, returns
   * a pass result.
   *
   * @param intent - The trade intent to evaluate
   * @param ctx - Context for checks (config, DB, oracle)
   * @returns The first rejection result, or a pass result if all checks pass
   */
  async evaluateAll(intent: TradeIntent, ctx: PolicyContext): Promise<CheckResult> {
    for (const check of this.checks.values()) {
      const result = await check.evaluate(intent, ctx);
      if (result.status === 'reject') {
        return {
          ...result,
          metadata: {
            ...result.metadata,
            [REJECTED_BY_KEY]: check.name,
          },
        };
      }
    }

    return { status: 'pass' };
  }

  /**
   * Get the list of registered check names (for diagnostics/logging).
   */
  get registeredChecks(): readonly string[] {
    return [...this.checks.keys()];
  }

  /**
   * Get the count of registered checks.
   */
  get size(): number {
    return this.checks.size;
  }
}
