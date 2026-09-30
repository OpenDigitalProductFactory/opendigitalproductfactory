// apps/web/lib/build/gauntlet-repair.ts
//
// BI-B2EEA6DE (BI-FBA2FDBE slice 2): a build whose guard gauntlet fails on its
// own change is handed back to its coding agent with the findings, a bounded
// number of times, then escalated to the operator once. Before this, review
// ended at gauntlet-failed and nothing carried the findings anywhere.
//
// State lives on FeatureBuild.verificationOut.gauntletRepair. The guard output
// itself stays on its ExternalEvidenceRecord (the single source of truth); the
// state points at it by record id.

/** Hand-backs per build before the operator is asked. */
export const GAUNTLET_REPAIR_MAX_ATTEMPTS = 2;

/** Tail of the guard output carried into the brief; the failure summary is at the end. */
const BRIEF_OUTPUT_CHARS = 8_000;

export type GauntletFailure = { treeSha: string | null; recordId: string | null; failedGuards: string[] };

export type GauntletRepairState = GauntletFailure & { attempts: number; escalated?: boolean };

export type GauntletRepairDecision =
  | { action: "repair"; next: GauntletRepairState }
  | { action: "escalate"; next: GauntletRepairState }
  | { action: "none"; next: GauntletRepairState };

/**
 * Every hand-back counts, whether or not the last one changed the tree, so the
 * loop is bounded even when a repair leaves the code as it was.
 */
export function decideGauntletRepair(
  prev: GauntletRepairState | undefined,
  failure: GauntletFailure,
): GauntletRepairDecision {
  const attempts = prev?.attempts ?? 0;
  if (prev?.escalated) return { action: "none", next: prev };
  if (attempts >= GAUNTLET_REPAIR_MAX_ATTEMPTS) {
    return { action: "escalate", next: { ...failure, attempts, escalated: true } };
  }
  return { action: "repair", next: { ...failure, attempts: attempts + 1 } };
}

export type GauntletRepairTask = { title: string; implement: string; verify: string };

export function buildGauntletRepairTask(input: { failedGuards: string[]; output: string }): GauntletRepairTask {
  const guards = input.failedGuards.map((g) => `- ${g}`).join("\n");
  const tail = input.output.length > BRIEF_OUTPUT_CHARS
    ? `…(earlier output omitted)\n${input.output.slice(-BRIEF_OUTPUT_CHARS)}`
    : input.output;
  return {
    title: `Fix guard findings: ${input.failedGuards.join(", ")}`.slice(0, 200),
    implement: [
      "The repository guards failed on this build's own change. Fix what they report so the change meets the repository's rules.",
      "",
      "Failing guards:",
      guards,
      "",
      "Guard output (tail):",
      "```",
      tail,
      "```",
      "",
      "Rules:",
      "- Fix the change itself: add the missing manifest, metadata, classification, docs or spec link the guard names, or regenerate a derived artifact with the command the guard prints.",
      "- Never weaken, skip or edit a guard, its script, its baseline or its allow-list to make it pass.",
      "- Keep the fix to what the guards report; do not rework unrelated code.",
      "- Commit the fix on this build's branch.",
    ].join("\n"),
    verify: "Re-run the failing guards named above; each must pass on the committed tree.",
  };
}

function readState(verificationOut: unknown): GauntletRepairState | undefined {
  if (!verificationOut || typeof verificationOut !== "object" || Array.isArray(verificationOut)) return undefined;
  const state = (verificationOut as { gauntletRepair?: unknown }).gauntletRepair;
  if (!state || typeof state !== "object") return undefined;
  const s = state as Partial<GauntletRepairState>;
  if (typeof s.attempts !== "number" || !Array.isArray(s.failedGuards)) return undefined;
  return {
    treeSha: s.treeSha ?? null,
    recordId: s.recordId ?? null,
    failedGuards: s.failedGuards,
    attempts: s.attempts,
    escalated: s.escalated === true,
  };
}

export type RouteOutcome = "repair-queued" | "escalated" | "already-escalated" | "not-in-review";

/**
 * Called by the review job when finalize ends gauntlet-failed. Hands the build
 * back to its build phase and queues the repair, or escalates once the bound
 * is spent.
 */
export async function routeGauntletFailureToRepair(buildId: string, failure: GauntletFailure): Promise<RouteOutcome> {
  const { prisma } = await import("@dpf/db");
  const { canTransitionPhase } = await import("@/lib/feature-build-types");
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true, buildId: true, phase: true, title: true, originatingBacklogItemId: true,
      verificationOut: true, buildExecState: true,
    },
  });
  if (!build || build.phase !== "review") return "not-in-review";

  const decision = decideGauntletRepair(readState(build.verificationOut), failure);
  if (decision.action === "none") return "already-escalated";

  const verificationOut = {
    ...(build.verificationOut && typeof build.verificationOut === "object" && !Array.isArray(build.verificationOut)
      ? build.verificationOut as Record<string, unknown>
      : {}),
    gauntletRepair: decision.next,
  };
  const log = (summary: string) =>
    prisma.buildActivity.create({ data: { buildId, tool: "gauntlet_repair", summary: summary.slice(0, 1000) } }).catch(() => {});

  if (decision.action === "escalate") {
    await prisma.featureBuild.update({ where: { id: build.id }, data: { verificationOut: verificationOut as never } });
    const { escalateBuildToHuman } = await import("./escalate-build-to-human");
    await escalateBuildToHuman({
      buildPk: build.id,
      buildId,
      featureTitle: build.title,
      originatingBacklogItemId: build.originatingBacklogItemId,
      phase: "review",
      rounds: decision.next.attempts,
      issues: failure.failedGuards.map((guard) => ({ severity: "important", description: `Guard still failing after ${decision.next.attempts} repair attempt(s): ${guard}` })),
      log,
    });
    return "escalated";
  }

  if (!canTransitionPhase("review", "build")) return "not-in-review";
  // step "complete" with verificationOut set: if the repair job dies, the
  // stranded-build sweep's advance-to-review branch returns the build to
  // review, where this attempt is already counted. A missing or failed step
  // would instead restart code generation from the brief.
  const execState = build.buildExecState && typeof build.buildExecState === "object" && !Array.isArray(build.buildExecState)
    ? build.buildExecState as Record<string, unknown>
    : {};
  const { error: _error, failedAt: _failedAt, ...keptExecState } = execState;
  const moved = await prisma.featureBuild.updateMany({
    where: { id: build.id, phase: "review" },
    data: {
      phase: "build",
      verificationOut: verificationOut as never,
      buildExecState: { ...keptExecState, step: "complete" } as never,
    },
  });
  if (moved.count === 0) return "not-in-review";
  await log(`Guards failed on this build's change (${failure.failedGuards.join(", ")}); handed back to the coding agent, attempt ${decision.next.attempts} of ${GAUNTLET_REPAIR_MAX_ATTEMPTS}.`);

  const { jobs } = await import("@/lib/jobs");
  await jobs.send({ name: "build/gauntlet.repair", data: { buildId } });
  return "repair-queued";
}

export type RepairRunOutcome = "repaired-and-requeued" | "not-in-build" | "no-state" | "dispatch-failed";

/** The repair job body: dispatch one repair task, then return the build to review. */
export async function runGauntletRepair(buildId: string): Promise<RepairRunOutcome> {
  const { prisma } = await import("@dpf/db");
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { phase: true, createdById: true, verificationOut: true },
  });
  if (!build || build.phase !== "build") return "not-in-build";
  const state = readState(build.verificationOut);
  if (!state) return "no-state";

  let output = "";
  if (state.recordId) {
    const record = await prisma.externalEvidenceRecord.findUnique({ where: { id: state.recordId }, select: { details: true } });
    const evidence = (record?.details as { evidence?: { output?: unknown } } | null)?.evidence;
    output = typeof evidence?.output === "string" ? evidence.output : "";
  }
  const task = buildGauntletRepairTask({ failedGuards: state.failedGuards, output });

  const { runGauntletRepairTask } = await import("./build-orchestrator");
  const dispatched = await runGauntletRepairTask({ buildId, userId: build.createdById, task }).catch(() => false);

  // Back to review either way: finalize re-evaluates the tree, and the attempt
  // is already counted, so a repair that changed nothing still ends bounded.
  const back = await prisma.featureBuild.updateMany({ where: { buildId, phase: "build" }, data: { phase: "review" } });
  if (back.count > 0) {
    const { queueBuildReviewVerification } = await import("@/lib/build-review-verification-trigger");
    await queueBuildReviewVerification(buildId);
  }
  return dispatched ? "repaired-and-requeued" : "dispatch-failed";
}
