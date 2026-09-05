// apps/web/lib/queue/functions/deliberation-run.ts
// Task 6.9 — Async Inngest runner for a DeliberationRun.
//
// Mirrors the brand-extract.ts pattern: a pure core (`runDeliberation`)
// that tests exercise directly, plus an Inngest function wrapper that
// ships it through the queue.
//
// Responsibilities:
//   1. Mark TaskRun.status = "active" at start (idempotent; orchestrator
//      already sets it on bootstrap, but the resume-path may not have).
//   2. Wrap pipeline-v2 with a BranchDispatcher instance so the
//      orchestrator can dispatch each branch through the existing routing
//      pipeline — no parallel routing path (spec §9.7).
//   3. Persist per-branch routeDecision on the TaskNode.
//   4. Resume an incomplete run without re-running completed branches.
//   5. Emit pushThreadProgress events on queue, dispatch, completion,
//      degradation, and finish.

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import { sealDeliberationOnRoom } from "@/lib/deliberation/deliberation-room-bridge.server";

/* -------------------------------------------------------------------------- */
/* Public input                                                               */
/* -------------------------------------------------------------------------- */

export type RunDeliberationInput = {
  userId: string;
  deliberationRunId: string;
  taskRunId: string; // TaskRun.taskRunId (the external id, not the db cuid)
  threadId: string | null;
  /** When true, resumes the existing DeliberationRun — skipping branches
   *  already marked completed. When false, assumes the orchestrator has
   *  just created the run and dispatches everything. */
  resume?: boolean;
};

/* -------------------------------------------------------------------------- */
/* Pure core                                                                  */
/* -------------------------------------------------------------------------- */

export async function runDeliberation(input: RunDeliberationInput): Promise<void> {
  const { prisma } = await import("@dpf/db");
  const { pushThreadProgress } = await import("@/lib/tak/thread-progress");
  const { synthesizeDeliberation } = await import("@/lib/deliberation/synthesizer");
  const { buildBranchRequestContract } = await import(
    "@/lib/deliberation/request-contract"
  );
  const { extractRoleRecipes, getPattern } = await import(
    "@/lib/deliberation/registry"
  );
  const { computeActualDiversity } = await import("@/lib/deliberation/orchestrator");
  const { routeEndpointV2 } = await import("@/lib/routing/pipeline-v2");

  // Mark TaskRun working (idempotent). Uses the canonical A2A "working"
  // state via markTaskRunWorking() so lastHeartbeatAt is set atomically and
  // the stall-detection watchdog (BI-4ab6be39) can do its job. Was previously
  // writing the non-canonical "active" — pre-existing rows in that state are
  // still caught because the watchdog accepts both values.
  try {
    const { markTaskRunWorking } = await import("@/lib/observability/heartbeat");
    const moved = await markTaskRunWorking(input.taskRunId);
    if (!moved) {
      // Terminal or parked already — never resurrect it (BI-D208E70C).
      console.warn(
        `[deliberation-run] TaskRun ${input.taskRunId} is not in a working-entry state; leaving its status untouched`,
      );
    }
  } catch (err) {
    console.warn(
      "[deliberation-run] failed to mark TaskRun working",
      input.taskRunId,
      err instanceof Error ? err.message : err,
    );
  }

  // Load the DeliberationRun plus its branch TaskNodes and the pattern row.
  const run = await prisma.deliberationRun.findUnique({
    where: { id: input.deliberationRunId },
    include: {
      pattern: { select: { slug: true, providerStrategyHints: true } },
      branchNodes: {
        select: {
          id: true,
          taskNodeId: true,
          workerRole: true,
          status: true,
          routeDecision: true,
        },
      },
    },
  });

  if (!run) {
    console.warn(
      `[deliberation/runner] deliberationRun=${input.deliberationRunId} not found; aborting`,
    );
    return;
  }

  const pattern = await getPattern(run.pattern.slug);
  const recipes = pattern ? extractRoleRecipes(pattern) : new Map();

  await pushThreadProgress(input.threadId, input.taskRunId, {
    type: "deliberation:queued",
    deliberationRunId: run.id,
    patternSlug: run.pattern.slug,
  });

  // Determine role per branch; use the workerRole on the TaskNode as the
  // reverse mapping key. author/reviewer/skeptic/debater/adjudicator live
  // at deliberation-level; TaskNode.workerRole maps to those.
  const priorProviderIds: string[] = [];
  const priorModelIds: string[] = [];
  let degradationEmitted = false;
  let budgetHalted = false;
  let branchBudgetUsed = 0;

  // Sort: worker branches (everyone except adjudicator/summarizer) first.
  const workerBranches = run.branchNodes.filter(
    (b) => b.workerRole !== "summarizer",
  );
  const adjudicatorBranches = run.branchNodes.filter(
    (b) => b.workerRole === "summarizer",
  );

  for (const branch of workerBranches) {
    // Resume: skip already-completed branches.
    if (input.resume && branch.status === "completed") {
      continue;
    }
    if (budgetHalted) {
      await prisma.taskNode.update({
        where: { id: branch.id },
        data: { status: "cancelled", completedAt: new Date() },
      });
      continue;
    }

    const roleId = reverseRoleFromWorkerRole(branch.workerRole);
    const contract = buildBranchRequestContract({
      roleId,
      strategyProfile: run.strategyProfile as Parameters<
        typeof buildBranchRequestContract
      >[0]["strategyProfile"],
      diversityMode: run.diversityMode as Parameters<
        typeof buildBranchRequestContract
      >[0]["diversityMode"],
      artifactType: run.artifactType,
      recipeHint: recipes.get(roleId),
      priorProviderIds: [...priorProviderIds],
      priorModelIds: [...priorModelIds],
    });

    await prisma.taskNode.update({
      where: { id: branch.id },
      data: {
        status: "running",
        startedAt: new Date(),
        requestContract: JSON.parse(JSON.stringify(contract)),
      },
    });

    await pushThreadProgress(input.threadId, input.taskRunId, {
      type: "deliberation:branch_dispatched",
      deliberationRunId: run.id,
      branchNodeId: branch.id,
      role: roleId,
    });

    // Dispatch through pipeline-v2.
    try {
      const { loadEndpointManifests, loadPolicyRules, loadOverrides } = await import(
        "@/lib/routing/loader"
      );
      const [manifests, policies, overrides] = await Promise.all([
        loadEndpointManifests(),
        loadPolicyRules(),
        loadOverrides(contract.taskType),
      ]);

      const decision = await routeEndpointV2(manifests, contract, policies, overrides);

      const providerId = decision.selectedEndpoint
        ? (manifests.find((m) => m.id === decision.selectedEndpoint)?.providerId ?? null)
        : null;
      const modelId = decision.selectedModelId ?? null;

      if (!decision.selectedEndpoint) {
        await prisma.taskNode.update({
          where: { id: branch.id },
          data: {
            status: "failed",
            completedAt: new Date(),
            routeDecision: JSON.parse(JSON.stringify(decision)),
          },
        });
        await pushThreadProgress(input.threadId, input.taskRunId, {
          type: "deliberation:branch_completed",
          deliberationRunId: run.id,
          branchNodeId: branch.id,
          role: roleId,
          success: false,
        });
        continue;
      }

      if (providerId) priorProviderIds.push(providerId);
      if (modelId) priorModelIds.push(modelId);

      // Diversity degradation surfaces when later branches are forced onto a
      // less diverse provider than requested.
      if (
        !degradationEmitted &&
        priorProviderIds.length >= 2 &&
        run.diversityMode === "multi-provider-heterogeneous" &&
        new Set(priorProviderIds).size === 1
      ) {
        degradationEmitted = true;
        await pushThreadProgress(input.threadId, input.taskRunId, {
          type: "deliberation:degraded_diversity",
          deliberationRunId: run.id,
          from: "multi-provider-heterogeneous",
          to: "multi-model-same-provider",
          reason: "routing layer could not return a distinct provider",
        });
      }

      await prisma.taskNode.update({
        where: { id: branch.id },
        data: {
          status: "completed",
          completedAt: new Date(),
          routeDecision: JSON.parse(JSON.stringify(decision)),
        },
      });
      branchBudgetUsed += 0; // real cost surfaces post-call; tracked elsewhere.

      await pushThreadProgress(input.threadId, input.taskRunId, {
        type: "deliberation:branch_completed",
        deliberationRunId: run.id,
        branchNodeId: branch.id,
        role: roleId,
        success: true,
      });

      // Budget cap: halt remaining worker branches if we exceed budgetUsd.
      if (
        typeof run.budgetUsd === "number" &&
        run.budgetUsd !== null &&
        run.budgetUsd > 0 &&
        branchBudgetUsed >= run.budgetUsd
      ) {
        budgetHalted = true;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[deliberation/runner] branch dispatch failed run=${run.id} branch=${branch.id}: ${message}`,
      );
      await prisma.taskNode.update({
        where: { id: branch.id },
        data: { status: "failed", completedAt: new Date() },
      });
      await pushThreadProgress(input.threadId, input.taskRunId, {
        type: "deliberation:branch_completed",
        deliberationRunId: run.id,
        branchNodeId: branch.id,
        role: roleId,
        success: false,
      });
    }
  }

  // Record honest diversity.
  const actualDiversity = computeActualDiversity(
    run.diversityMode as Parameters<typeof computeActualDiversity>[0],
    priorProviderIds,
    priorModelIds,
  );
  await prisma.deliberationRun.update({
    where: { id: run.id },
    data: {
      metadata: {
        requestedDiversity: run.diversityMode,
        actualDiversity,
        budgetHalted,
      },
    },
  });

  // Collect branch artifacts for the synthesizer. For this release, branch
  // content is NOT yet generated — endpoint calls happen when the route
  // decision is invoked by the caller. The synthesizer is given the branch
  // roster so it can record an honest consensus state (and the build UI
  // can see which branches contributed).
  const completedWorkers = await prisma.taskNode.findMany({
    where: {
      deliberationRunId: run.id,
      workerRole: { not: "summarizer" },
    },
    select: { id: true, workerRole: true, status: true },
  });

  const branchArtifacts = completedWorkers.map((b) => ({
    branchNodeId: b.id,
    role: reverseRoleFromWorkerRole(b.workerRole),
    completed: b.status === "completed",
    failureReason:
      b.status === "failed"
        ? "dispatch failed"
        : b.status === "cancelled"
          ? "budget-halted"
          : undefined,
  }));

  const { compactSummary } = await synthesizeDeliberation({
    deliberationRunId: run.id,
    artifactType: run.artifactType,
    branches: branchArtifacts,
    budgetHalted,
    degradedDiversity: actualDiversity === "constrained",
  });

  // Mark adjudicator nodes completed now that synthesis is done.
  for (const adj of adjudicatorBranches) {
    await prisma.taskNode.update({
      where: { id: adj.id },
      data: { status: "completed", completedAt: new Date() },
    });
  }

  // EP-DELIBERATION-ROOMS (BI-F8C5444A): seal the verdict onto a finite Work Room,
  // NON-FATALLY — the deliberation stands even if room-sealing fails.
  try {
    const adjudicator = adjudicatorBranches[0];
    if (adjudicator?.taskNodeId) {
      await sealDeliberationOnRoom({
        deliberationRunId: run.id,
        adjudicatorTaskNodeId: adjudicator.taskNodeId,
        consensusState: compactSummary.consensusState,
      });
    }
  } catch (err) {
    console.warn(
      `[deliberation-run] room seal skipped for ${run.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  await pushThreadProgress(input.threadId, input.taskRunId, {
    type: "deliberation:completed",
    deliberationRunId: run.id,
    consensusState: compactSummary.consensusState,
  });

  // Mark TaskRun completed when the deliberation is its only work: a run the
  // orchestrator bootstrapped for this deliberation (whatever routeContext the
  // caller passed — the /build review path passes "/build", BI-D208E70C), or a
  // caller-owned run whose routeContext says deliberation is all it does.
  try {
    const { isBootstrappedDeliberationTaskRunId } = await import(
      "@/lib/deliberation/bootstrapped-task-run"
    );
    const tr = await prisma.taskRun.findUnique({
      where: { taskRunId: input.taskRunId },
      select: { routeContext: true },
    });
    if (
      tr?.routeContext === "deliberation" ||
      isBootstrappedDeliberationTaskRunId(input.taskRunId)
    ) {
      await prisma.taskRun.update({
        where: { taskRunId: input.taskRunId },
        data: { status: "completed", completedAt: new Date() },
      });
    }
  } catch (err) {
    console.warn(
      `[deliberation-run] failed to mark TaskRun ${input.taskRunId} completed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Worker-role → deliberation roleId reverse map                              */
/* -------------------------------------------------------------------------- */

function reverseRoleFromWorkerRole(workerRole: string): string {
  switch (workerRole) {
    case "planner":
      return "author";
    case "reviewer":
      return "reviewer";
    case "skeptical_reviewer":
      return "skeptic";
    case "researcher":
      return "debater";
    case "summarizer":
      return "adjudicator";
    default:
      return "reviewer";
  }
}

/* -------------------------------------------------------------------------- */
/* Inngest wrapper                                                            */
/* -------------------------------------------------------------------------- */

export const deliberationRun = inngest.createFunction(
  {
    id: "deliberation/run",
    retries: 1,
    concurrency: [{ key: "event.data.deliberationRunId", limit: 1 }],
    triggers: [{ event: "deliberation/run.start" }, { event: "deliberation/run.resume" }],
  },
  async ({ event, step }) => {
    // Gate at entry — refuses new deliberation starts during drain. In-flight
    // deliberations complete naturally (runDeliberation is a single step.run
    // so there's no natural mid-flow boundary to suspend; refactoring it to
    // expose per-branch step.run boundaries for gateBetweenSteps is tracked
    // as a follow-up under BI-QUIESCE-004b).
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    const data = event.data as unknown as RunDeliberationInput;
    const resume = event.name === "deliberation/run.resume";
    await step.run("run-deliberation", async () => {
      await runDeliberation({ ...data, resume });
    });
    return { ok: true };
  },
);
