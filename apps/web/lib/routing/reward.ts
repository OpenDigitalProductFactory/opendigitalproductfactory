/**
 * EP-INF-006: Reward function for routing outcome signals.
 * Pure function — no DB access, no side effects.
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RewardWeights {
  quality: number;       // graderScore weight
  correctness: number;   // schema/tool validity weight
  latency: number;
  cost: number;
  humanFeedback: number;
}

export const DEFAULT_REWARD_WEIGHTS: RewardWeights = {
  quality: 0.45,
  correctness: 0.25,
  latency: 0.10,
  cost: 0.10,
  humanFeedback: 0.10,
};

export interface OutcomeSignals {
  graderScore: number | null;      // 0-1
  humanScore: number | null;       // 0-1
  schemaValid: boolean | null;
  toolSuccess: boolean | null;
  latencyMs: number;
  costUsd: number | null;
  providerErrorCode: string | null;
}

// ── computeReward ─────────────────────────────────────────────────────────────

/**
 * Compute a scalar reward in [0, 1] from outcome signals.
 *
 * Hard failures return 0 immediately:
 *   - providerErrorCode is set (non-null, non-empty)
 *   - schemaValid === false
 *   - toolSuccess === false
 *
 * Component scores:
 *   - quality:       graderScore ?? 0.5
 *   - correctness:   avg((schemaValid === true ? 1 : 0.5), (toolSuccess === true ? 1 : 0.5))
 *                    null means "not applicable" → 0.5
 *   - latency:       max(0, 1 - latencyMs / 30_000)
 *   - cost:          costUsd !== null ? max(0, 1 - costUsd / 0.10) : 0.5
 *   - humanFeedback: humanScore ?? 0.5
 *
 * Result is clamped to [0, 1].
 */
export function computeReward(
  signals: OutcomeSignals,
  weights: RewardWeights = DEFAULT_REWARD_WEIGHTS
): number {
  // ── Hard failures ──────────────────────────────────────────────────────────
  if (signals.providerErrorCode !== null && signals.providerErrorCode !== "") {
    return 0;
  }
  if (signals.schemaValid === false) {
    return 0;
  }
  if (signals.toolSuccess === false) {
    return 0;
  }

  // ── Component scores ───────────────────────────────────────────────────────

  // quality: graderScore with neutral fallback
  const quality = signals.graderScore ?? 0.5;

  // correctness: null boolean → "not applicable" → 0.5; true → 1.0; false already returned 0
  const schemaComponent = signals.schemaValid === true ? 1 : 0.5;
  const toolComponent = signals.toolSuccess === true ? 1 : 0.5;
  const correctness = (schemaComponent + toolComponent) / 2;

  // latency: 0ms → 1.0, 30 000ms → 0.0, beyond 30 000ms → clamped to 0
  const latency = Math.max(0, 1 - signals.latencyMs / 30_000);

  // cost: null → neutral 0.5; $0 → 1.0; $0.10 → 0.0; beyond $0.10 → clamped to 0
  const cost =
    signals.costUsd !== null
      ? Math.max(0, 1 - signals.costUsd / 0.10)
      : 0.5;

  // humanFeedback: humanScore with neutral fallback
  const humanFeedback = signals.humanScore ?? 0.5;

  // ── Weighted sum ───────────────────────────────────────────────────────────
  const raw =
    weights.quality * quality +
    weights.correctness * correctness +
    weights.latency * latency +
    weights.cost * cost +
    weights.humanFeedback * humanFeedback;

  // ── Clamp to [0, 1] ────────────────────────────────────────────────────────
  return Math.min(1, Math.max(0, raw));
}
