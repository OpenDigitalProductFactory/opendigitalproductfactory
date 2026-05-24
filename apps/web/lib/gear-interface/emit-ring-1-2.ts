// apps/web/lib/gear-interface/emit-ring-1-2.ts
//
// Reduction Gear Phase 0 — Ring 1→2 (Coworker → Workflow) emitter.
//
// The single production emit path for Phase 0. Called immediately after a
// BuildPhaseRun completes its source-of-truth write. Fetches the FeatureBuild
// outcome signals + dispatch-attempt history, normalizes via the phase-run
// adapter, and emits one GearInterface row.
//
// Non-blocking: every failure is logged and swallowed. The build flow must
// never depend on this emit succeeding.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §4.1
// BI:   BI-85CB31F0

import { prisma } from "@dpf/db";
import {
  phaseRunToRing12Input,
  type PhaseName,
  type PhaseOutcomeSignals,
  type PhaseRunSource,
} from "./source-adapters/phase-run";
import { emitGearInterface } from "./writer";

/**
 * Read FeatureBuild + most recent dispatch attempts for the phase window and
 * normalize them into PhaseOutcomeSignals. Pure-ish — only reads, no writes.
 */
export async function loadPhaseOutcomeSignals(
  buildId: string,
  phaseStartedAt: Date,
  phaseCompletedAt: Date,
): Promise<PhaseOutcomeSignals | null> {
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      claimedByAgentId: true,
      codingProvider: true,
      uxVerificationStatus: true,
      acceptanceMet: true,
      abandonedAt: true,
      abandonReason: true,
    },
  });

  if (!build) return null;

  const attempts = await prisma.buildDispatchAttempt.findMany({
    where: {
      buildId,
      startedAt: { gte: phaseStartedAt, lte: phaseCompletedAt },
    },
    select: { failureAxis: true, success: true },
  });

  const failedAttempts = attempts.filter((a) => !a.success);
  const worstFailureAxis =
    failedAttempts.length > 0
      ? (failedAttempts.find((a) => a.failureAxis !== "unknown")?.failureAxis ??
          failedAttempts[0]!.failureAxis)
      : null;

  // FeatureBuild.acceptanceMet is JSON; treat truthy as accepted, missing/null
  // as unknown, explicit false as rejected. Phase 0 uses a simple shape check.
  let acceptanceMet: boolean | null = null;
  if (build.acceptanceMet && typeof build.acceptanceMet === "object") {
    const am = build.acceptanceMet as { met?: unknown; status?: unknown };
    if (am.met === true || am.status === "met") acceptanceMet = true;
    else if (am.met === false || am.status === "not-met") acceptanceMet = false;
  }

  return {
    claimedByAgentId: build.claimedByAgentId,
    codingProvider: build.codingProvider,
    uxVerificationStatus: build.uxVerificationStatus as PhaseOutcomeSignals["uxVerificationStatus"],
    acceptanceMet,
    abandoned: build.abandonedAt != null && build.abandonedAt <= phaseCompletedAt,
    abandonReason: build.abandonReason,
    worstFailureAxis,
    attemptCount: attempts.length,
  };
}

/**
 * Read the canonical BuildPhaseRun row and shape it as the PhaseRunSource the
 * adapter consumes. Decimal costs are coerced to string for adapter input.
 */
async function loadPhaseRunSource(
  buildId: string,
  phase: PhaseName,
): Promise<PhaseRunSource | null> {
  const row = await prisma.buildPhaseRun.findUnique({
    where: { buildId_phase: { buildId, phase } },
  });
  if (!row || !row.completedAt) return null;

  return {
    id: row.id,
    buildId: row.buildId,
    phase: row.phase as PhaseName,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationMs: row.durationMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd ? row.costUsd.toString() : null,
    inferenceCount: row.inferenceCount,
    providerId: row.providerId,
  };
}

/**
 * Public entry — called from completeBuildPhaseRun() after the source row
 * settles. Idempotent (writer upserts on idempotencyKey), so replays / retries
 * are safe.
 */
export async function emitRing12FromCompletedPhase(
  buildId: string,
  phase: PhaseName,
): Promise<void> {
  const phaseRunSource = await loadPhaseRunSource(buildId, phase);
  if (!phaseRunSource || !phaseRunSource.completedAt) return;

  const signals = await loadPhaseOutcomeSignals(
    buildId,
    phaseRunSource.startedAt,
    phaseRunSource.completedAt,
  );
  if (!signals) return;

  const input = phaseRunToRing12Input(phaseRunSource, signals);
  if (!input) return;

  await emitGearInterface(input);
}
