import type { ActionIntent } from '../core/action-types.js';
import type { CheckResult } from '../types/result.js';
import type { PolicyContext } from './context.js';

/**
 * Typed constant for the metadata key used to identify which check rejected a trade.
 */
export const REJECTED_BY_KEY = 'rejectedBy' as const;

/** Pre-built pass result to avoid repeated object creation. */
export const POLICY_PASS: CheckResult = { status: 'pass' };

/** Pass result indicating the check was skipped (e.g., price unavailable). */
export function policyPassSkipped(reason: string): CheckResult {
  return { status: 'pass', metadata: { skipped: true, reason } };
}

/**
 * Interface for a single policy check in the evaluation pipeline.
 *
 * Each check is an independent guardrail that evaluates an ActionIntent
 * against a specific rule (e.g., token allowlist, spending limit).
 *
 * To add a new guardrail:
 * 1. Implement this interface in a new file
 * 2. Define the corresponding config schema section
 * 3. Register it in the PolicyCheckRegistry
 */
export interface PolicyCheck {
  /** Unique identifier for this check (e.g., "token_allowlist") */
  readonly name: string;

  /** Human-readable description of what this check enforces */
  readonly description: string;

  /**
   * Evaluate an action intent against this check's rules.
   *
   * @param intent - The action intent to evaluate
   * @param ctx - Context containing config, DB, oracle, etc.
   * @returns CheckResult indicating pass or reject with details
   */
  evaluate(intent: ActionIntent, ctx: PolicyContext): Promise<CheckResult>;
}
