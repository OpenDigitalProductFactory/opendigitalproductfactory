/**
 * DPF2-REMOVABLE BRIDGE MODULE.
 *
 * This entire module is a disposable bridge for the pre-DPF2 routing stack. It
 * centralises every threshold, phrase, and copy string used to detect and
 * penalise "non-acting" provider turns — replies that read fluently but never
 * actually invoke the tool a `tool-action` task required.
 *
 * It exists only until DPF2's native acting-contract enforcement lands. When
 * DPF2 ships, delete this file together with its consumers:
 *   - apps/web/lib/tak/non-acting-answer-detector.ts
 *   - apps/web/lib/tak/non-acting-failover.ts
 *   - apps/web/lib/routing/record-non-acting-failure.ts
 *   - the non-acting penalty wiring in apps/web/lib/routing/cost-ranking.ts
 *   - the `DPF2-REMOVABLE` non-acting failover block in
 *     apps/web/lib/tak/agentic-loop.ts (helpers + zero-tool-call branch) and its
 *     test apps/web/lib/tak/agentic-loop-non-acting-failover.test.ts
 * Nothing here should be promoted into durable architecture.
 */

export const NON_ACTING_BRIDGE_CONFIG = {
  /** How many failover retries a non-acting turn may trigger before giving up. */
  maxFailoverRetries: 1,

  /** Only these task types are eligible for non-acting detection and failover. */
  eligibleTaskTypes: ["tool-action"],

  /** On retry, require a different adapter than the one that produced the non-acting turn. */
  requireDifferentAdapterOnRetry: true,

  /**
   * Phrases that, when present in a provider turn, signal the request was left
   * unavailable or unfinished (guidance-only, no action taken). Matched
   * case-insensitively by the detector.
   */
  unavailableOrUnfinishedPhrases: [
    "guidance-only access",
    "unavailable",
    "unfinished",
    "the request is unfinished",
  ],

  /** Base penalty weight applied to an endpoint on its first recorded non-acting failure. */
  penaltyBaseWeight: 1,

  /** Half-life (ms) over which a recorded non-acting penalty decays back toward zero. 24h. */
  penaltyDecayHalfLifeMs: 24 * 60 * 60 * 1000,

  /**
   * Lower bound on the decayed penalty *factor* (not on successProb itself).
   * The factor multiplies an endpoint's base success probability, so clamping
   * it to this floor guarantees a heavily-penalised endpoint is downranked but
   * never fully zeroed out — a known-bad endpoint stays a last-resort candidate
   * rather than disappearing, which keeps routing recoverable.
   */
  penaltyFloor: 0.2,

  /** Synthetic provider error code emitted when a turn is classified as non-acting. */
  nonActingProviderErrorCode: "non-acting-answer",
} as const;

export type NonActingBridgeConfig = typeof NON_ACTING_BRIDGE_CONFIG;

Object.freeze(NON_ACTING_BRIDGE_CONFIG);
Object.freeze(NON_ACTING_BRIDGE_CONFIG.eligibleTaskTypes);
Object.freeze(NON_ACTING_BRIDGE_CONFIG.unavailableOrUnfinishedPhrases);
