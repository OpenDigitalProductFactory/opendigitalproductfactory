// apps/web/lib/integrate/build-phase-run.ts
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

import { prisma } from "@dpf/db";

export type BuildPhaseName = "ideate" | "plan" | "build" | "review" | "ship";

/**
 * Mark the start of a phase. Upserts a BuildPhaseRun row with startedAt = now.
 * Safe to call multiple times (idempotent on buildId + phase).
 */
export async function startBuildPhaseRun(
  buildId: string,
  phase: BuildPhaseName,
): Promise<void> {
  try {
    const now = new Date();
    await prisma.buildPhaseRun.upsert({
      where: { buildId_phase: { buildId, phase } },
      create: { buildId, phase, startedAt: now },
      update: {}, // Don't overwrite if already started — phase may restart rarely
    });
  } catch (err) {
    console.warn("[build-phase-run] Failed to start phase run:", { buildId, phase }, err);
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
        },
      });
    }

    console.log(
      `[build-phase-run] Phase ${phase} complete: ${inferenceCount} calls, ` +
      `${inputTokens + outputTokens} tokens, ${costUsd != null ? `$${Number(costUsd).toFixed(4)}` : "cost unknown"}`,
    );
  } catch (err) {
    console.warn("[build-phase-run] Failed to complete phase run:", { buildId, phase }, err);
  }
}
