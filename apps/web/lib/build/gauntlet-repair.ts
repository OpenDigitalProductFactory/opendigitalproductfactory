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

import { enforceBuildInitiativeReadiness } from "@/lib/build/build-entry-gate";

/** Hand-backs per build before the operator is asked. */
export const GAUNTLET_REPAIR_MAX_ATTEMPTS = 2;

/** Tail of the guard output carried into the brief; the failure summary is at the end. */
const BRIEF_OUTPUT_CHARS = 8_000;

export type ReviewFinding = { severity: string; description: string; location?: string; suggestion?: string };

/**
 * What failed. `source` "review" is a semantic change review that asked for
 * repair (BI-50E8802C); its findings are carried on the state because a review
 * receipt is not a gauntlet record. `source` "risk" is a failure analysis that
 * named a risk the change does not mitigate (BI-83E1ADF8); its findings are the
 * risks. `source` "tests" is a confirmed scoped-test or typecheck failure
 * (BI-33B54E4B); its findings name the failing tests and `recordId` points at
 * the scoped-test record holding the output. `source` "conflict" is a review
 * refresh onto upstream main that conflicted (BI-2CCD5C0E); its findings name
 * the conflicted files and `ontoRef` is the ref the build tree rebases onto.
 * All hand-backs share one bound.
 */
export type GauntletFailure = {
  treeSha: string | null;
  recordId: string | null;
  failedGuards: string[];
  source?: "guards" | "review" | "risk" | "tests" | "conflict";
  findings?: ReviewFinding[];
  ontoRef?: string;
};

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

export function buildReviewRepairTask(input: { findings: ReviewFinding[] }): GauntletRepairTask {
  const lines = input.findings.map((f) => [
    `- [${f.severity}] ${f.description}`,
    f.location ? `  at ${f.location}` : null,
    f.suggestion ? `  suggestion: ${f.suggestion}` : null,
  ].filter(Boolean).join("\n"));
  return {
    title: `Fix review findings (${input.findings.length})`,
    implement: [
      "The independent code review of this build's change found blocking problems. Fix each one in the change itself.",
      "",
      "Findings:",
      ...lines,
      "",
      "Rules:",
      "- Fix the cause in the code; add or correct tests where a finding says behavior is unverified.",
      "- Never weaken, skip or delete a test, guard or review policy to make the review pass.",
      "- Keep the fix to what the findings report; do not rework unrelated code.",
      "- Commit the fix on this build's branch.",
    ].join("\n"),
    verify: "Each finding above is resolved in the committed tree, and the build's scoped tests and typecheck pass.",
  };
}

export function buildRiskRepairTask(input: { findings: ReviewFinding[] }): GauntletRepairTask {
  const lines = input.findings.map((f) => `- [${f.severity}] ${f.description}`);
  return {
    title: `Mitigate unmitigated risks (${input.findings.length})`,
    implement: [
      "The failure analysis of this build's change named risks the change does not mitigate. Change the code so each one is prevented or contained.",
      "",
      "Risks:",
      ...lines,
      "",
      "Rules:",
      "- Mitigate the risk in the code: guard the input, handle the failure, add the missing check, and add a test that shows the mitigation works.",
      "- If a risk comes from the build environment rather than this change (for example a tool or test runner that was unavailable), do not change unrelated code to hide it; leave the change as it is.",
      "- Never remove a check, test or guard, and never describe a risk as mitigated without the code that mitigates it.",
      "- Keep the fix to the risks listed; do not rework unrelated code.",
      "- Commit the fix on this build's branch.",
    ].join("\n"),
    verify: "Each risk above is prevented or contained by the committed tree, and the build's scoped tests and typecheck pass.",
  };
}

export function buildTestRepairTask(input: { findings: ReviewFinding[]; output: string }): GauntletRepairTask {
  const tail = input.output.length > BRIEF_OUTPUT_CHARS
    ? `…(earlier output omitted)\n${input.output.slice(-BRIEF_OUTPUT_CHARS)}`
    : input.output;
  return {
    title: `Fix failing tests (${input.findings.length})`,
    implement: [
      "The scoped tests or the typecheck of this build's change fail on its committed tree. Fix the change so they pass.",
      "",
      "Failures:",
      ...input.findings.map((f) => `- ${f.description}`),
      "",
      "Test output (tail):",
      "```",
      tail || "(no output recorded)",
      "```",
      "",
      "Rules:",
      "- Fix the cause in the code. When the change deliberately alters behavior an existing test pins, update that test to the new behavior and say why in the commit.",
      "- When a test asserts something the change was meant to add, add it; do not delete the assertion.",
      "- Never weaken, skip or delete a test, guard or check to make it pass.",
      "- If a failure comes from the test environment rather than this change, leave the code as it is; the owner is told once the repair bound is spent.",
      "- Keep the fix to the failures listed; do not rework unrelated code.",
      "- Commit the fix on this build's branch.",
    ].join("\n"),
    verify: "The failing tests above pass on the committed tree, and the build's scoped tests and typecheck pass.",
  };
}

/** Where a build tree rebases when the conflict state does not name a ref. */
const DEFAULT_CONFLICT_ONTO_REF = "origin/main";

export function buildConflictRepairTask(input: { findings: ReviewFinding[]; ontoRef?: string }): GauntletRepairTask {
  const onto = input.ontoRef || DEFAULT_CONFLICT_ONTO_REF;
  return {
    title: `Resolve conflicts with upstream main (${input.findings.length})`,
    implement: [
      `This build's branch is far behind upstream main, so the guard gauntlet cannot run, and rebasing it onto ${onto} conflicts. Rebase it and resolve the conflicts.`,
      "",
      "Conflicts:",
      ...input.findings.map((f) => `- ${f.description}`),
      "",
      "Steps, in the build tree:",
      `1. Commit any uncommitted work, then run: git rebase ${onto}`,
      "2. For each conflicted file, keep upstream main's changes and re-apply this build's intent on top of them. Remove every conflict marker.",
      "3. For a generated artifact (*.generated.*), take upstream's version and regenerate it with the command its guard or header names instead of merging it by hand.",
      "4. git add the resolved files and run git rebase --continue; repeat until the rebase finishes.",
      "",
      "Rules:",
      "- Never use git rebase --skip, and never drop or revert this build's commits to make the rebase apply.",
      "- Never discard upstream main's changes to a file to keep this build's older copy.",
      "- If a conflict cannot be resolved without changing what this build is for, run git rebase --abort and stop; the owner is told once the repair bound is spent.",
      "- Keep the work to the rebase; do not rework unrelated code.",
    ].join("\n"),
    verify: `git status shows no rebase in progress and no unmerged paths, and git merge-base --is-ancestor ${onto} HEAD succeeds.`,
  };
}

/** The repair brief for a hand-back, chosen by what failed. */
export function repairTaskFor(state: GauntletRepairState, guardOutput: string): GauntletRepairTask {
  if (state.source === "conflict") {
    return buildConflictRepairTask({ findings: state.findings ?? [], ontoRef: state.ontoRef });
  }
  if (state.source === "tests") {
    return buildTestRepairTask({ findings: state.findings ?? [], output: guardOutput });
  }
  if (state.source === "risk" && state.findings && state.findings.length > 0) {
    return buildRiskRepairTask({ findings: state.findings });
  }
  if (state.source === "review" && state.findings && state.findings.length > 0) {
    return buildReviewRepairTask({ findings: state.findings });
  }
  return buildGauntletRepairTask({ failedGuards: state.failedGuards, output: guardOutput });
}

/** The owner-facing issues an escalation carries, by what is still failing. */
export function escalationIssuesFor(failure: GauntletFailure, attempts: number): Array<{ severity: string; description: string }> {
  const label = failure.source === "risk" ? "Unmitigated risk" : failure.source === "tests" ? "Scoped test" : "Review finding";
  if (failure.source && failure.source !== "guards" && failure.findings?.length) {
    return failure.findings.map((f) => ({
      severity: f.severity,
      description: failure.source === "conflict"
        ? `Refresh onto upstream main still conflicts after ${attempts} repair attempt(s): ${f.description}`
        : failure.source === "tests"
          ? `${label} still failing after ${attempts} repair attempt(s): ${f.description}`
          : `${label} still open after ${attempts} repair attempt(s): ${f.description}`,
    }));
  }
  return failure.failedGuards.map((guard) => ({ severity: "important", description: `Guard still failing after ${attempts} repair attempt(s): ${guard}` }));
}

export function readGauntletRepairState(verificationOut: unknown): GauntletRepairState | undefined {
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
    source: s.source === "review" || s.source === "risk" || s.source === "tests" || s.source === "conflict" ? s.source : "guards",
    findings: Array.isArray(s.findings) ? s.findings : undefined,
    ...(typeof s.ontoRef === "string" && s.ontoRef ? { ontoRef: s.ontoRef } : {}),
  };
}

export type RouteOutcome = "repair-queued" | "escalated" | "already-escalated" | "not-in-review" | "not-ready";

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

  const decision = decideGauntletRepair(readGauntletRepairState(build.verificationOut), failure);
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
      issues: escalationIssuesFor(failure, decision.next.attempts),
      log,
    });
    return "escalated";
  }

  if (!canTransitionPhase("review", "build")) return "not-in-review";
  // Re-entering build is gated like every entry into build: the initiative must
  // still be ready for implementation.
  const readiness = await enforceBuildInitiativeReadiness({
    buildId, target: "implementation", targetPhase: "build", expectedPhase: "review",
  });
  if (!readiness.allowed) {
    await log(`Guards failed on this build's change (${failure.failedGuards.join(", ")}), but it was not handed back: ${readiness.message}`);
    return "not-ready";
  }
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
  const what = failure.source === "conflict"
    ? `Refreshing this build onto upstream main conflicts (${(failure.findings ?? []).slice(0, 3).map((f) => f.description).join("; ")})`
    : failure.source === "review"
    ? `The code review found ${failure.findings?.length ?? 0} blocking problem(s) in this build's change`
    : failure.source === "risk"
      ? `The failure analysis named ${failure.findings?.length ?? 0} risk(s) this build's change does not mitigate`
      : failure.source === "tests"
        ? `${failure.failedGuards.join(", ")} failed on this build's change (${(failure.findings ?? []).slice(0, 3).map((f) => f.description).join("; ")})`
        : `Guards failed on this build's change (${failure.failedGuards.join(", ")})`;
  await log(`${what}; handed back to the coding agent, attempt ${decision.next.attempts} of ${GAUNTLET_REPAIR_MAX_ATTEMPTS}.`);

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
  const state = readGauntletRepairState(build.verificationOut);
  if (!state) return "no-state";

  let output = "";
  if (state.recordId) {
    const record = await prisma.externalEvidenceRecord.findUnique({ where: { id: state.recordId }, select: { details: true } });
    const evidence = (record?.details as { evidence?: { output?: unknown } } | null)?.evidence;
    output = typeof evidence?.output === "string" ? evidence.output : "";
  }
  const task = repairTaskFor(state, output);

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
