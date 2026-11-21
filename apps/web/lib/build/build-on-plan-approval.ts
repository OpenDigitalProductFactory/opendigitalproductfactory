// apps/web/lib/build/build-on-plan-approval.ts
//
// The run body of an approved plan's build: given a build already in `build`,
// it runs the build orchestrator (one specialist per plan task, dependency
// ordering, progress, auto-advance to review).
//
// BI-EB4BB4A0: this is no longer called fire-and-forget, and it no longer
// moves the phase. performPlanToBuildTransition commits the plan→build write
// together with a `dispatch-build` Workroom effect
// (lib/build/build-dispatch-effect.ts). The Workroom effect worker (the
// absorbed T3 core) runs that effect once, and the effect calls runApprovedBuild.
// The run's own `start_build` and its second plan→build write (path
// `build-on-plan-approval`) are retired: the transition's build-branch-init
// step already made the branch, and the transition is the only plan→build
// write on this path.
import { prisma } from "@dpf/db";
import { allPlannedTasksDone } from "@/lib/build/build-dispatch-effect";

/**
 * The dispatching user's auth context. BI-937E106A: this once selected
 * `platformRole` directly on User, which has no such field — the role lives on
 * the user's group. Prisma threw on every call, the error was swallowed, and
 * every auto-dispatched build ran as a roleless non-superuser, so the tool
 * filter handed the specialists no tools at all. Exported so a test can check
 * it against the committed schema.
 */
export const BUILD_DISPATCH_USER_SELECT = {
  isSuperuser: true,
  groups: {
    take: 1,
    select: { platformRole: { select: { roleId: true } } },
  },
} as const;

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
 * Run the build orchestrator for a build that is already in `build`. Called by
 * the `dispatch-build` Workroom effect (build-dispatch-effect.ts), which
 * decides that no other run is in flight. Never throws.
 */
export async function runApprovedBuild(params: {
  buildId: string;
  userId: string;
}): Promise<BuildDispatchOutcome> {
  const { buildId, userId } = params;
  const t0 = Date.now();

  const log = (summary: string) =>
    logBuildActivity(buildId, "build_dispatch", summary);

  try {
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

    // The plan→build transition owns the phase move; this run only works on a build already there.
    if (build.phase !== "build") {
      await log(`Skipped — phase is ${build.phase}, expected build`);
      return { kind: "skipped-wrong-phase", reason: `phase=${build.phase}` };
    }

    if (!build.buildPlan) {
      await log("Skipped — no buildPlan");
      return { kind: "skipped-no-plan", reason: "buildPlan is null" };
    }

    const plan = build.buildPlan as { fileStructure?: unknown[]; tasks?: unknown[] };
    if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
      await log("Skipped — buildPlan has no tasks");
      return { kind: "skipped-no-plan", reason: "buildPlan.tasks is empty" };
    }

    // Idempotency: every planned task already finished, so the orchestrator has run. Avoid re-running and re-billing.
    if (allPlannedTasksDone(build.buildPlan, build.taskResults)) {
      await log("Skipped — all tasks already complete");
      return { kind: "skipped-already-building", reason: "all tasks DONE" };
    }

    // Lookup the user's auth context (needed by orchestrator for specialist dispatch).
    // A failed lookup must stop the dispatch. Running the orchestrator without
    // an auth context strips every tool and records the model's prose as
    // finished work (BI-937E106A).
    let userRow;
    try {
      userRow = await prisma.user.findUnique({
        where: { id: userId },
        select: BUILD_DISPATCH_USER_SELECT,
      });
    } catch (err) {
      const msg = `Could not read the dispatching user's access: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`;
      await log(msg);
      return { kind: "dispatched-failure", error: msg, durationMs: Date.now() - t0 };
    }
    if (!userRow) {
      const msg = `Dispatching user ${userId} not found; not starting code generation without an access context.`;
      await log(msg);
      return { kind: "dispatched-failure", error: msg, durationMs: Date.now() - t0 };
    }

    const platformRole = userRow?.groups?.[0]?.platformRole?.roleId ?? null;
    const isSuperuser = userRow?.isSuperuser ?? false;

    // Use the build's existing threadId for event bus routing (real-time UI
    // updates flow to the correct panel), or generate an ephemeral one.
    const parentThreadId = build.threadId ?? `auto-build-${buildId}-${Date.now()}`;

    await log(`Dispatching build orchestrator: ${plan.tasks.length} tasks, parentThread=${parentThreadId}`);

    // The orchestrator handles the entire build phase: task dependency graph,
    // specialist dispatch (engine selection, residency and model eligibility
    // through getBuildStudioConfig), progress tracking, and auto-advance to
    // review on completion.
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
