// apps/web/lib/build/build-phase-run.ts
//
// EP-COST-001 Phase 3: BuildPhaseRun cost rollup writer.
//
// Records token/cost usage per Build Studio phase (ideate, plan, build, review, ship).
// The BuildPhaseRun table has one row per phase per build — startedAt is written
// when the phase begins, completedAt + token rollup is written when it ends.
//
// Wire points:
//   Start: call startBuildPhaseRun() when the phase begins (phase transition occurs).
//   Complete: call completeBuildPhaseRun() when the phase ends (before the next phase starts).
//
// Both functions are non-fatal — errors are logged but never throw, so a DB hiccup
// never blocks the phase transition itself.
//
// Spec: docs/superpowers/specs/2026-05-19-ai-cost-governance.md §Phase 3
//
// Reduction Gear Phase 0: completeBuildPhaseRun also dual-emits a Ring 1→2
// GearInterface record after the source row settles (BI-85CB31F0).

import { prisma } from "@dpf/db";
import { emitRing12FromCompletedPhase } from "@/lib/gear-interface/emit-ring-1-2";
import { emitRing23FromCompletedShip } from "@/lib/gear-interface/emit-ring-2-3";
import { getQuiescenceLevel, QuiescingError } from "@/lib/self-upgrade/quiescence";
import type { AutonomousBuildExecutionProfileRefV1 } from "@/lib/build/autonomous-build-eligibility-reader";

export type BuildPhaseName = "ideate" | "plan" | "build" | "review" | "ship";

/**
 * Mark the start of a phase. Creates a BuildPhaseRun row with startedAt = now.
 * Safe to call multiple times while the phase is in flight: the original
 * startedAt is kept. A finished row is reopened as a new attempt.
 */
export async function startBuildPhaseRun(
  buildId: string,
  phase: BuildPhaseName,
  opts?: {
    executionProfileRef?: AutonomousBuildExecutionProfileRefV1;
  },
): Promise<void> {
  // BI-QUIESCE-005 entry-point gate: refuse new phase transitions during
  // quiescence drain. The idempotency property at upsert means restarting
  // the SAME phase after upgrade is fine; this only refuses transitions
  // that would START a new phase mid-drain. In-flight phases (rows with
  // completedAt IS NULL) continue uninterrupted.
  const level = await getQuiescenceLevel();
  if (level !== "normal") {
    throw new QuiescingError(level);
  }

  try {
    const now = new Date();
    const existing = await prisma.buildPhaseRun.findUnique({
      where: { buildId_phase: { buildId, phase } },
      select: { completedAt: true },
    });
    if (!existing) {
      await prisma.buildPhaseRun.create({
        data: {
          buildId,
          phase,
          startedAt: now,
          executionProfileRef: opts?.executionProfileRef,
        },
      });
      return;
    }
    // An in-flight row keeps its original startedAt. Resetting it would restart
    // the quiescence reaper clock on every duplicate start. A finished row is a
    // new attempt and must reopen, or the retry is invisible to the drain.
    if (existing.completedAt) {
      await prisma.buildPhaseRun.update({
        where: { buildId_phase: { buildId, phase } },
        data: {
          startedAt: now,
          completedAt: null,
          durationMs: null,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: null,
          inferenceCount: 0,
          providerId: null,
          ...(opts?.executionProfileRef
            ? { executionProfileRef: opts.executionProfileRef }
            : {}),
        },
      });
    }
  } catch (err) {
    console.warn("[build-phase-run] Failed to start phase run:", { buildId, phase }, err);
  }
}

/**
 * Close an open phase row when the attempt has stopped and nothing is running.
 *
 * Quiescence treats `completedAt IS NULL` as in-flight work and will spend the
 * whole drain budget on it. A provider refusal or capacity deferral returns in
 * seconds; leaving the start row open makes that finished attempt block a
 * self-upgrade until the 15-minute dead-phase reaper (which is longer than the
 * drain). Does not create a row and does not record a successful completion.
 */
export async function releaseUnfinishedBuildPhaseRun(
  buildId: string,
  phase: BuildPhaseName,
): Promise<void> {
  try {
    await prisma.buildPhaseRun.updateMany({
      where: { buildId, phase, completedAt: null },
      data: { completedAt: new Date() },
    });
  } catch (err) {
    console.warn(
      "[build-phase-run] Failed to release unfinished phase run:",
      { buildId, phase },
      err,
    );
  }
}

export async function stampBuildPhaseExecutionProfile(
  buildId: string,
  phase: BuildPhaseName,
  executionProfileRef: AutonomousBuildExecutionProfileRefV1,
): Promise<void> {
  try {
    await prisma.buildPhaseRun.updateMany({
      where: { buildId, phase, completedAt: null },
      data: { executionProfileRef },
    });
  } catch (err) {
    console.warn(
      "[build-phase-run] Failed to stamp execution profile:",
      { buildId, phase },
      err,
    );
  }
}

/**
 * Mark a phase as complete and aggregate token usage from AdapterRunTelemetry
 * for the phase's time window (startedAt → now).
 *
 * If no BuildPhaseRun row exists (startBuildPhaseRun wasn't called), creates one
 * with startedAt inferred from the earliest AdapterRunTelemetry row in the window.
 */
export async function completeBuildPhaseRun(
  buildId: string,
  phase: BuildPhaseName,
  opts?: {
    providerId?: string;
    executionProfileRef?: AutonomousBuildExecutionProfileRefV1;
  },
): Promise<void> {
  try {
    const now = new Date();

    // Find or create the phase run row
    let phaseRun = await prisma.buildPhaseRun.findUnique({
      where: { buildId_phase: { buildId, phase } },
    });

    const startedAt = phaseRun?.startedAt ?? now;

    // Aggregate token usage from AdapterRunTelemetry for the phase window.
    const tokenAgg = await prisma.adapterRunTelemetry.aggregate({
      where: {
        buildId,
        startedAt: { gte: startedAt, lte: now },
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        estimatedCostUsd: true,
      },
      _count: { id: true },
    });

    const inputTokens = tokenAgg._sum.inputTokens ?? 0;
    const outputTokens = tokenAgg._sum.outputTokens ?? 0;
    const costUsd = tokenAgg._sum.estimatedCostUsd ?? null;
    const inferenceCount = tokenAgg._count.id ?? 0;
    const durationMs = now.getTime() - startedAt.getTime();

    if (phaseRun) {
      await prisma.buildPhaseRun.update({
        where: { buildId_phase: { buildId, phase } },
        data: {
          completedAt: now,
          durationMs,
          inputTokens,
          outputTokens,
          costUsd: costUsd != null ? costUsd : undefined,
          inferenceCount,
          providerId: opts?.providerId ?? phaseRun.providerId,
        },
      });
    } else {
      // No start row — create a complete row retroactively
      await prisma.buildPhaseRun.create({
        data: {
          buildId,
          phase,
          startedAt,
          completedAt: now,
          durationMs: 0,
          inputTokens,
          outputTokens,
          costUsd: costUsd != null ? costUsd : undefined,
          inferenceCount,
          providerId: opts?.providerId,
          executionProfileRef: opts?.executionProfileRef,
        },
      });
    }

    console.log(
      `[build-phase-run] Phase ${phase} complete: ${inferenceCount} calls, ` +
      `${inputTokens + outputTokens} tokens, ${costUsd != null ? `$${Number(costUsd).toFixed(4)}` : "cost unknown"}`,
    );

    // Reduction Gear Ring 1→2 dual-emit (BI-85CB31F0). Non-blocking: any
    // failure must never affect the phase-run write above. The emitter pulls
    // its own outcome signals from FeatureBuild + BuildDispatchAttempt.
    void emitRing12FromCompletedPhase(buildId, phase).catch((err) => {
      console.warn(
        "[gear-interface] Ring 1→2 emit failed for completed phase:",
        { buildId, phase },
        err,
      );
    });

    // Reduction Gear Ring 2→3 emit on ship completion (BI-861C4959, Phase 1).
    // Only fires when phase==="ship" — that's the gear-train boundary between
    // Workflow (Ring 2) and Archetype-context outcome (Ring 3). Same
    // non-blocking contract as Ring 1→2.
    if (phase === "ship") {
      void emitRing23FromCompletedShip(buildId).catch((err) => {
        console.warn(
          "[gear-interface] Ring 2→3 emit failed for completed ship:",
          { buildId },
          err,
        );
      });
    }
  } catch (err) {
    console.warn("[build-phase-run] Failed to complete phase run:", { buildId, phase }, err);
  }
}
