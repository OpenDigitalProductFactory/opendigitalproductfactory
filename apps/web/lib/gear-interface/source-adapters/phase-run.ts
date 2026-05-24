// apps/web/lib/gear-interface/source-adapters/phase-run.ts
//
// Reduction Gear Phase 0 — Ring 1→2 primary source adapter.
//
// Build Studio BuildPhaseRun completion is the outer shaft (Ring 2 advance);
// the inner shaft is the set of coworker actions (ToolExecution rows,
// AdapterRunTelemetry inferences, BuildDispatchAttempt records) that occurred
// within the phase's [startedAt, completedAt] window.
//
// This adapter does NOT touch the DB. Higher layers fetch the source rows and
// call here with the assembled context. That keeps adapters pure, testable,
// and the Ring 1→2 hook responsible for orchestration. (Spec §9.1 refactor
// allocation: "Normalize source-event adapters with one function per source type.")
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §4.1

import type { GearInterfaceInput } from "../types";
import type { SlipReason } from "../types";

export type PhaseName = "ideate" | "plan" | "build" | "review" | "ship";

export interface PhaseRunSource {
  /** PhaseRun row id — the canonical shaftSourceId for the emit. */
  id: string;
  buildId: string;
  phase: PhaseName;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: string | number | null;
  inferenceCount: number;
  providerId: string | null;
}

/**
 * Outcome signals derived from the surrounding FeatureBuild. The hook is
 * responsible for fetching these — keeping them out of the adapter signature
 * keeps it pure.
 */
export interface PhaseOutcomeSignals {
  /** From FeatureBuild — used to pick the agent triple. */
  claimedByAgentId: string | null;
  codingProvider: string | null;

  /** From FeatureBuild.uxVerificationStatus + acceptanceMet — drives torqueTechnical. */
  uxVerificationStatus: "complete" | "failed" | "running" | "skipped" | null;
  acceptanceMet: boolean | null;

  /** Whether the build was abandoned at or after this phase. */
  abandoned: boolean;
  abandonReason: string | null;

  /** From BuildDispatchAttempt — failure axis if any attempt in this phase failed. */
  worstFailureAxis: string | null;
  attemptCount: number;
}

/**
 * Map a Build Studio dispatch failureAxis string to a GearInterface slip
 * reason. Kept as a small lookup so unknown axes surface explicitly rather
 * than silently dropping into a default.
 */
function failureAxisToSlipReason(axis: string | null): SlipReason | null {
  if (!axis || axis === "unknown") return null;
  const map: Record<string, SlipReason> = {
    "rate-limit": "rate-limit",
    timeout: "failed-outcome",
    "tool-fabrication": "capability-gap",
    "schema-drift": "capability-gap",
    "policy-block": "safety-block",
    "cost-overrun": "cost-overrun",
    "human-override": "human-override",
  };
  return map[axis] ?? "failed-outcome";
}

/**
 * Compute torqueTechnical for a phase completion from outcome signals.
 *
 * Pass criteria: phase completed, no failures, UX verification not failed.
 * Partial:       completed but had retries / warnings.
 * Fail:          abandoned, or acceptance not met, or UX verification failed.
 */
function computeTorqueTechnical(signals: PhaseOutcomeSignals): number {
  if (signals.abandoned) return 0;
  if (signals.uxVerificationStatus === "failed") return 0;
  if (signals.acceptanceMet === false) return 0;
  if (signals.worstFailureAxis && signals.worstFailureAxis !== "unknown") {
    // Phase finished despite a failed attempt — partial credit
    return 0.5;
  }
  if (signals.attemptCount > 1) {
    // Multiple attempts needed; technically succeeded but inefficient
    return 0.75;
  }
  return 1.0;
}

/**
 * Confidence in the automated grading. Lower when we are filling in gaps from
 * "ran cleanly" signals alone; higher when UX verification or acceptance gives
 * an explicit answer.
 */
function computeTorqueConfidence(signals: PhaseOutcomeSignals): number {
  if (signals.uxVerificationStatus === "complete" || signals.uxVerificationStatus === "failed") {
    return 0.9;
  }
  if (signals.acceptanceMet === true || signals.acceptanceMet === false) {
    return 0.8;
  }
  if (signals.abandoned) return 0.95;
  return 0.6;
}

/**
 * Build the canonical Ring 1→2 input for a completed BuildPhaseRun.
 *
 * Returns null when the phase has not actually completed yet — the caller
 * should not emit pre-completion (the row would be incomplete).
 */
export function phaseRunToRing12Input(
  phaseRun: PhaseRunSource,
  signals: PhaseOutcomeSignals,
  options: { organizationId?: string | null } = {},
): GearInterfaceInput | null {
  if (!phaseRun.completedAt) return null;

  const torqueTechnical = computeTorqueTechnical(signals);
  const torqueConfidence = computeTorqueConfidence(signals);
  const slipReason = failureAxisToSlipReason(signals.worstFailureAxis);
  const slipDetected = torqueTechnical < 1.0 || slipReason !== null;

  // Agent triple resolution — prefer the explicitly claimed coworker, fall
  // back to the coding provider id, and finally to "unknown" so the triple
  // remains queryable.
  const agentIdForTriple =
    signals.claimedByAgentId ??
    signals.codingProvider ??
    `unknown-agent:${phaseRun.buildId}`;

  return {
    interfaceClass: "internal-adjacent",
    transmissionDirection: "outward",
    innerRing: 1,
    outerRing: 2,
    shaftSourceType: "phase-run",
    shaftSourceId: phaseRun.id,
    sourceEventAt: phaseRun.completedAt,
    actorType: "agent",
    actorId: agentIdForTriple,
    intent: `complete-phase-${phaseRun.phase}`,
    capabilityName: `build-phase-${phaseRun.phase}`,
    capabilityVocabularyVersion: "raw-v0",
    archetypeContext: null, // Ring 1→2 is allowed null (spec §3.3)
    agentIdForTriple,
    torqueTechnical,
    torqueValue: null, // Phase 0 — value attribution deferred (spec §11.2)
    torqueConfidence,
    ratioConsumed: phaseRun.inferenceCount,
    outcomeType: torqueTechnical >= 1.0 ? "transmission" : "slip",
    slipDetected,
    slipReason,
    costUsd: phaseRun.costUsd ?? null,
    inputTokens: phaseRun.inputTokens || null,
    outputTokens: phaseRun.outputTokens || null,
    durationMs: phaseRun.durationMs ?? null,
    graderType: "automated",
    graderId: "build-phase-run.completeBuildPhaseRun",
    rationale:
      signals.abandoned && signals.abandonReason
        ? `abandoned: ${signals.abandonReason}`
        : null,
    organizationId: options.organizationId ?? null,
  };
}

// Exposed for tests.
export const _internals = {
  computeTorqueTechnical,
  computeTorqueConfidence,
  failureAxisToSlipReason,
};
