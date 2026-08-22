// apps/web/lib/build/build-on-plan-approval.ts
//
// Auto-dispatch the Build-phase code generation when a Build Studio build
// advances from plan → build (i.e., reviewBuildPlan passes).
//
// Why this exists:
//   reviewBuildPlan advances the phase to "build" but nothing triggers
//   runBuildOrchestrator. The operator must open the build's chat panel and
//   manually send a message before the orchestrator runs. This is exactly the
//   same friction gap that existed between ideate→plan (fixed by
//   plan-on-approval.ts).
//
//   runBuildOrchestrator is fully deterministic — given a plan, it dispatches
//   specialist agents (one per task), handles task dependency ordering, and
//   auto-advances to review when all tasks complete. It only needs the plan,
//   the buildId, and a userId. No interactive coworker conversation required.
//
// Called from: reviewBuildPlan success path in mcp-tools.ts (fire-and-forget).

import { prisma } from "@dpf/db";
import { enforceBuildInitiativeReadiness } from "@/lib/build/build-entry-gate";

function logBuildActivity(buildId: string, tool: string, summary: string): Promise<void> {
  return prisma.buildActivity.create({ data: { buildId, tool, summary } }).then(() => void 0).catch(() => void 0);
}

type BuildDispatchOutcome =
  | { kind: "skipped-no-plan"; reason: string }
  | { kind: "skipped-wrong-phase"; reason: string }
  | { kind: "skipped-already-building"; reason: string }
  | { kind: "dispatched-success"; totalTasks: number; completedTasks: number; durationMs: number }
  | { kind: "dispatched-failure"; error: string; durationMs: number };

/**
 * Auto-dispatch the build orchestrator for a build that just advanced from
 * plan → build. Designed to be called fire-and-forget from the reviewBuildPlan
 * success path; never throws.
 */
export async function dispatchBuildForApprovedPlan(params: {
  buildId: string;
  userId: string;
}): Promise<BuildDispatchOutcome> {
  const { buildId, userId } = params;
  const t0 = Date.now();

  const log = (summary: string) =>
    logBuildActivity(buildId, "build_dispatch", summary);

  try {
    // 1. Fetch current build state.
    const build = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: {
        phase: true,
        buildPlan: true,
        taskResults: true,
        threadId: true,
        title: true,
        kind: true,
      },
    });

    if (!build) {
      await log(`Build not found: ${buildId}`);
      return { kind: "dispatched-failure", error: "Build not found", durationMs: Date.now() - t0 };
    }

    // Accept both "plan" (will be advanced to build by start_build) and "build"
    if (build.phase !== "build" && build.phase !== "plan") {
      await log(`Skipped — phase is ${build.phase}, expected plan or build`);
      return { kind: "skipped-wrong-phase", reason: `phase=${build.phase}` };
    }

    if (!build.buildPlan) {
      await log("Skipped — no buildPlan");
      return { kind: "skipped-no-plan", reason: "buildPlan is null" };
    }
    if (build.phase === "plan") {
      const readiness = await enforceBuildInitiativeReadiness({
        buildId, target: "implementation", targetPhase: "build", expectedPhase: "plan",
      });
      if (!readiness.allowed) {
        await log(`Skipped — ${readiness.message}`);
        return { kind: "dispatched-failure", error: readiness.message, durationMs: Date.now() - t0 };
      }
    }

    const plan = build.buildPlan as { fileStructure?: unknown[]; tasks?: unknown[] };
    if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
      await log("Skipped — buildPlan has no tasks");
      return { kind: "skipped-no-plan", reason: "buildPlan.tasks is empty" };
    }

    // Idempotency guard: if task results already exist and are non-empty, the
    // orchestrator has already run. Avoid re-running and re-billing.
    const existingResults = build.taskResults as
      | { status?: string; tasks?: unknown[] }
      | null;
    if (existingResults?.tasks && Array.isArray(existingResults.tasks) && existingResults.tasks.length > 0) {
      const alreadyDone = (existingResults.tasks as Array<{ status?: string }>)
        .every(t => t.status === "DONE" || t.status === "DONE_WITH_CONCERNS");
      if (alreadyDone) {
        await log("Skipped — all tasks already complete");
        return { kind: "skipped-already-building", reason: "all tasks DONE" };
      }
    }

    // 2. Lookup the user's auth context (needed by orchestrator for specialist dispatch).
    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        platformRole: true,
        isSuperuser: true,
        groups: {
          take: 1,
          select: { platformRole: { select: { roleId: true } } },
        },
      },
    }).catch(() => null);

    const platformRole = userRow?.groups?.[0]?.platformRole?.roleId ?? null;
    const isSuperuser = userRow?.isSuperuser ?? false;

    // 3. Use the build's existing threadId for event bus routing (real-time UI
    //    updates flow to the correct panel), or generate an ephemeral one.
    const parentThreadId = build.threadId ?? `auto-build-${buildId}-${Date.now()}`;

    // 3b. Call start_build via executeTool to initialize the sandbox branch.
    //     This handles the sandbox availability check AND creates the build branch
    //     on the FeatureBuild record, which is required before runBuildOrchestrator.
    //     If already initialized (idempotent), start_build returns success and we continue.
    try {
      const { executeTool } = await import("@/lib/mcp-tools");
      const startResult = await executeTool(
        "start_build",
        { buildId },
        userId,
        { featureBuildId: buildId },
      );
      if (!startResult.success) {
        await log(`start_build failed: ${String(startResult.message ?? startResult.error ?? "unknown").slice(0, 200)}`);
        return { kind: "dispatched-failure", error: `start_build failed: ${startResult.message}`, durationMs: Date.now() - t0 };
      }
      await log("start_build succeeded — sandbox ready, build branch initialized");
    } catch (startErr) {
      const msg = String(startErr instanceof Error ? startErr.message : startErr).slice(0, 200);
      await log(`start_build threw: ${msg}`);
      return { kind: "dispatched-failure", error: msg, durationMs: Date.now() - t0 };
    }

    // Re-fetch to get current phase. start_build initializes the branch but
    // does NOT advance the phase — that happens in reviewBuildPlan's gate check.
    // If the gate was previously blocked (e.g. sandbox unavailable), we advance
    // the phase directly here since start_build has now confirmed sandbox readiness.
    const buildWithBranch = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { phase: true, buildBranch: true },
    });

    if (buildWithBranch?.phase === "plan" && buildWithBranch.buildBranch) {
      // start_build set the branch — advance phase to build manually
      await prisma.featureBuild.update({ where: { buildId }, data: { phase: "build" } });
      await log("Phase advanced to build (start_build confirmed sandbox ready)");
    } else if (buildWithBranch?.phase !== "build") {
      await log(`Phase is ${buildWithBranch?.phase} after start_build — cannot advance, skipping orchestrator`);
      return { kind: "skipped-wrong-phase", reason: `phase=${buildWithBranch?.phase} after start_build` };
    }

    await log(`Dispatching build orchestrator: ${plan.tasks.length} tasks, parentThread=${parentThreadId}`);

    // 4. Import and run the orchestrator. It handles the entire build phase:
    //    task dependency graph, specialist dispatch, progress tracking, and
    //    auto-advance to review on completion.
    const { runBuildOrchestrator } = await import("@/lib/build/build-orchestrator");
    const result = await runBuildOrchestrator({
      buildId,
      plan: plan as Parameters<typeof runBuildOrchestrator>[0]["plan"],
      userId,
      platformRole,
      isSuperuser,
      parentThreadId,
      buildContext: `Auto-dispatched build for "${build.title}" (${build.kind})`,
    });

    const summary = `Build orchestration complete: ${result.completedTasks}/${result.totalTasks} tasks`;
    await log(summary);

    return {
      kind: "dispatched-success",
      totalTasks: result.totalTasks,
      completedTasks: result.completedTasks,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).slice(0, 300);
    try { await log(`Build dispatch failed: ${msg}`); } catch (_) { /**/ }
    return { kind: "dispatched-failure", error: msg, durationMs: Date.now() - t0 };
  }
}
