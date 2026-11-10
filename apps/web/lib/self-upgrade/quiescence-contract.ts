/**
 * Activity Quiescence Protocol — the pure contract: run statuses, the drain
 * outcome, and the blocker-evidence shapes, plus the drain-wait default.
 *
 * A leaf module (no imports) so both quiescence.ts and drain-wait.ts can depend
 * on it without forming an import cycle (BI-F9EE05E5; the apps/web import-cycle
 * ratchet counts type-only and dynamic imports too). quiescence.ts re-exports
 * everything here, so existing importers are unchanged.
 *
 * Spec: docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md
 *   §5.1, §5.2, §5.6, §11a.
 */

/** The operator's decision (spec §11a item 2): an upgrade waits up to an hour
 *  for in-flight work by default before pausing for the operator. */
export const DEFAULT_DRAIN_WAIT_BUDGET_MS = 60 * 60 * 1000;

export const QUIESCENCE_RUN_STATUSES = [
  "pending",
  "preparing",
  "draining",
  "awaiting-operator", // BI-F9EE05E5: past the wait bound, level still draining; operator decides
  "ready-to-swap",
  "swapping",
  "completed",
  "deferred",
  "aborted",
  "failed",
] as const;

export type QuiescenceRunStatus = (typeof QUIESCENCE_RUN_STATUSES)[number];

export const TERMINAL_QUIESCENCE_STATUSES: ReadonlySet<QuiescenceRunStatus> = new Set([
  "completed",
  "deferred",
  "aborted",
  "failed",
]);

export function isTerminalQuiescenceStatus(status: string): boolean {
  return TERMINAL_QUIESCENCE_STATUSES.has(status as QuiescenceRunStatus);
}

/**
 * Per-state entry timestamps stored in QuiescenceRun.enteredStateAt.
 * Recorded as ISO strings so the JSON column is human-readable.
 */
export type EnteredStateAt = Partial<Record<QuiescenceRunStatus, string>>;

export type QuiescenceOutcome =
  | { ok: true; outcome: "ready-to-swap"; runId: string; finalSnapshot: ActiveSessionBlockers }
  | { ok: false; outcome: "deferred"; runId: string; deferSurface: string | null; finalSnapshot: ActiveSessionBlockers | null }
  | { ok: false; outcome: "aborted" | "failed"; runId: string; reason: string };

// ─── Active session blockers — evidence shapes ───────────────────────────

/**
 * Spec §5.6 — structured snapshot of what's in flight across all surfaces.
 * Populates parent spec's Layer 1 `activeSessionBlockers` column.
 */
export type ActiveSessionBlockers = {
  capturedAt: string;
  thresholdMs: number;
  totalBlockers: number;
  hardBlockers: number;
  softBlockers: number;
  unobservableSurfaces: string[];
  surfaces: SurfaceBlocker[];
  /**
   * Health verdict on the blocker set (BI-12E24186). Non-null when the capture
   * auto-discounted a provably-empty deliberation loop cohort from the HARD
   * blockers so the drain proceeds on its own. Per the WWMD decision
   * (auto-discount + disclose, never silent), the panel renders this as the
   * hero line so the operator sees a diagnosis — "stuck loop, not live work" —
   * instead of a raw "AI coworker working ×N" that sends them to an empty page.
   */
  verdict?: BlockerVerdict | null;
};

/**
 * A one-line health diagnosis surfaced above the blocker list. Today the only
 * kind is the empty-deliberation-loop (the stub deliberation engine, BI-7B6B3C5C,
 * makes plan gates loop forever producing no output); the shape is left open for
 * future pathological patterns.
 */
export type BlockerVerdict = {
  kind: "empty-deliberation-loop";
  /** How many hard coworker-loop surfaces were reclassified to soft. */
  discountedCount: number;
  /** The builds whose plan deliberations are looping empty. */
  buildIds: string[];
  message: string;
};

export type SurfaceBlocker = {
  surface: string;
  detectionClass: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  kind: "hard" | "soft";
  blockerSignal: BlockerSignal;
  estimatedWaitMs: number | null;
  evidence: Record<string, unknown>;
};

export type BlockerSignal =
  | { class: "A"; model: string; rowId: string; status: string }
  | { class: "B"; model: string; mostRecentAt: string; windowMs: number; count: number }
  | { class: "C"; model: string; rowId: string; lastHeartbeatAt: string; staleAfterMs: number }
  | { class: "D"; functionId: string; runId: string; status: "Running" | "Scheduled"; currentStep?: string }
  | { class: "E"; registry: string; subscriberCount: number; sampleIds?: string[] }
  | { class: "F"; endpoint: string; observation: unknown }
  | { class: "G"; reason: string; mitigations: string[] };
