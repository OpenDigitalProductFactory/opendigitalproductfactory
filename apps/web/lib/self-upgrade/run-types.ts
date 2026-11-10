// apps/web/lib/self-upgrade/run-types.ts
//
// Shared self-upgrade run / quiescence shapes. Split out (BI-D77BF495) so the
// co-located SelfUpgradeTriggerControl (owns the trigger/force/abort actions)
// and the SelfUpgradeClient Advanced detail panel (read-only run history,
// activity, recovery point) describe the SAME server data without redefining
// it twice and risking drift.

export type SelfUpgradeRunStatus =
  | "queued"
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped"
  | "completing"
  | "rolled_back";

import type { RunImpactDigest } from "@/lib/self-upgrade/impact/types";

export type LatestRun = {
  runId: string;
  status: string;
  trigger: string | null;
  currentSha: string | null;
  targetSha: string | null;
  deployedSha: string | null;
  reason: string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  completionEvidence?: unknown;
  failureLog: string | null;
  createdAt: Date | string;
  /** The impact summary this run carried, when one was recorded at launch. */
  impactSummaryId?: string | null;
  targetTag?: string | null;
  dispatchStatus?:
    | "admission_pending"
    | "dispatching"
    | "dispatched"
    | "indeterminate"
    | "dispatch_failed"
    | null;
  dispatchAttemptCount?: number;
  dispatchError?: string | null;
  /**
   * "What did this run carry?" — the headline + counts persisted with the run,
   * so Run History answers which upgrade introduced a change instead of leaving
   * an operator to correlate a SHA pair by hand. Null when no summary was
   * recorded (a scheduled run that never generated one).
   */
  impact?: RunImpactDigest | null;
};

/**
 * One aggregated blocker line for the operator panel: a surface name, a
 * human-readable label, how many in-flight items share it, and the worst-case
 * wait. Built by collapsing the raw ActiveSessionBlockers.surfaces list (which
 * has one entry per in-flight item) by surface name.
 */
export type QuiescenceBlockerLine = {
  surface: string;
  label: string;
  kind: "hard" | "soft";
  count: number;
  estimatedWaitMs: number | null;
  /**
   * Operator-facing identity of a representative in-flight item on this surface
   * (BI-D0F4C6FB): the coworker/agent and its task title, so the panel can say
   * WHICH coworker is blocking instead of a bare "AI coworker working". Null for
   * surfaces without a per-item identity (e.g. recent-tool-execution).
   */
  sampleAgent?: string | null;
  sampleTitle?: string | null;
  /** Build the item belongs to, when it has one (BI-F9EE05E5 live progress). */
  sampleBuildId?: string | null;
  /** Oldest last-signal (heartbeat, or start if newer) across the collapsed
   *  group, ISO — drives the panel's "last active …" staleness line. */
  oldestSignalAt?: string | null;
  /** True when that oldest signal was already stale past the coworker liveness
   *  window at capture — a corpse the drain auto-reaps (BI-1C4179D0), shown to
   *  the operator as "unresponsive — clears automatically". */
  stale?: boolean;
};

export type QuiescenceActivity = {
  level: "normal" | "draining" | "swapping";
  runId: string | null;
  enteredAt: string;
  run: {
    runId: string;
    status: string;
    trigger: string;
    targetVersion: string | null;
    targetBundleHash: string | null;
    deferSurface: string | null;
    deferReason: string | null;
    budgetMs: number | null;
    drainStartedAt: string | null;
    lastHeartbeatAt: string | null;
  } | null;
  blockersCapturedAt: string | null;
  blockers: QuiescenceBlockerLine[];
  /** Health verdict for the panel hero line (BI-12E24186); null/absent when
   *  nothing was auto-discounted. Mirrors the server type in
   *  lib/self-upgrade/quiescence.ts. */
  verdict?: BlockerVerdict | null;
};

/**
 * A one-line health diagnosis surfaced above the blocker list (BI-12E24186).
 * Non-null when the drain auto-discounted a provably-empty deliberation loop
 * (the stub engine, BI-7B6B3C5C, loops plan gates that produce no output).
 */
export type BlockerVerdict = {
  kind: "empty-deliberation-loop";
  discountedCount: number;
  buildIds: string[];
  message: string;
};
