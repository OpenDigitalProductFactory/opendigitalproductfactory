// apps/web/lib/build/plan-on-approval.ts
//
// Auto-dispatch the Plan-phase implementation-plan generation when a Build Studio
// build advances from ideate → plan.
//
// Why this exists:
//   reviewDesignDoc advances the phase to "plan" but nothing triggers the next
//   step. The operator must open the build's chat panel and manually prompt the
//   coworker to generate a buildPlan. For every build that was ever promoted from
//   a backlog item, this is unnecessary friction: the design doc already contains
//   all the information the plan agent needs.
//
//   This module closes that gap with a fire-and-forget dispatch that mirrors the
//   ideate-on-approval.ts pattern:
//     1. Fetch designDoc + BI context.
//     2. Call routeAndCall (portal-side inference) with the plan-generation prompt.
//     3. Parse + validate the JSON { fileStructure, tasks } structure.
//     4. Persist as buildPlan evidence (same write path as saveBuildEvidence).
//     5. Auto-reviewBuildPlan (dual reviewer), which already auto-advances plan→build.
//
//   Plan generation is portal-side inference, not CLI dispatch. The plan is pure
//   JSON structure derived from the design doc — no sandbox file access needed.
//   The build orchestrator (which does need the CLI) fires in build-on-plan-approval.ts.
//
// Called from: reviewDesignDoc success path in mcp-tools.ts (fire-and-forget).

import { prisma } from "@dpf/db";
import { denialForNextAttempt, denyAfterUnparseable } from "@/lib/build/plan-generation-retry";
import { normalizeBuildPlanPaths } from "./build-plan-paths";
import { escalateBuildToHuman, SELF_FIX_CLASS } from "@/lib/build/escalate-build-to-human";

function logBuildActivity(buildId: string, tool: string, summary: string): Promise<void> {
  return prisma.buildActivity.create({ data: { buildId, tool, summary } }).then(() => void 0).catch(() => void 0);
}

type PlanDispatchOutcome =
  | { kind: "skipped-no-design-doc"; reason: string }
  | { kind: "skipped-already-has-plan"; reason: string }
  | { kind: "skipped-wrong-phase"; reason: string }
  | { kind: "dispatched-success"; taskCount: number; durationMs: number }
  | { kind: "dispatched-failure"; error: string; durationMs: number };

/** A plan-review blocking issue fed back into a revision round (BI-99B06AD1). */
export type PlanReviewIssue = { severity: string; description: string };

/**
 * Format prior plan-review issues into a revision instruction (BI-99B06AD1).
 * Pure + unit-tested. Returns "" when there are no issues so the prompt is
 * unchanged on the first generation round.
 */
export function formatPlanReviewFeedback(issues: ReadonlyArray<PlanReviewIssue>): string {
  if (!issues || issues.length === 0) return "";
  const lines = issues
    .slice(0, 20)
    .map((i) => `- [${i.severity}] ${i.description}`)
    .join("\n");
  return `\nThis is a REVISION. Your previous plan was REJECTED by review for these blocking issues — the revised plan MUST resolve every one of them:\n${lines}\n`;
}

/** Build the plan-generation prompt from the design doc. */
function buildPlanGenerationPrompt(params: {
  title: string;
  designDoc: Record<string, unknown>;
  biTitle: string | null;
  biBody: string | null;
  verifiedPaths?: string[];  // actual paths confirmed to exist in the codebase
  priorReviewIssues?: ReadonlyArray<PlanReviewIssue>; // BI-99B06AD1: revision feedback
}): string {
  const { title, designDoc, biTitle, biBody, verifiedPaths, priorReviewIssues } = params;
  const dd = designDoc as {
    problemStatement?: string;
    dataModel?: string;
    existingFunctionalityAudit?: string;
    existingCodeAudit?: string;
    reusePlan?: string;
    proposedApproach?: string;
    acceptanceCriteria?: string[] | string;
    accessibility?: string;
  };

  const acceptance = Array.isArray(dd.acceptanceCriteria)
    ? dd.acceptanceCriteria.join("; ")
    : (dd.acceptanceCriteria ?? "Not specified");

  return `You are generating an implementation plan for a Build Studio feature build.

FEATURE: ${title}
${biTitle ? `BACKLOG ITEM: ${biTitle}` : ""}
${formatPlanReviewFeedback(priorReviewIssues ?? [])}
APPROVED DESIGN DOCUMENT:
Problem: ${dd.problemStatement ?? "See BI body"}
Data Model: ${dd.dataModel ?? "None"}
Existing Code Audit: ${dd.existingCodeAudit ?? dd.existingFunctionalityAudit ?? "See design"}
Reuse Plan: ${dd.reusePlan ?? "None"}
Proposed Approach: ${dd.proposedApproach ?? "See design"}
Acceptance Criteria: ${acceptance}
${dd.accessibility ? `Accessibility: ${dd.accessibility}` : ""}
${biBody ? `\nBI CONTEXT:\n${biBody.slice(0, 2000)}` : ""}

Generate a concrete implementation plan. Respond with ONLY valid JSON matching this exact schema:
{
  "fileStructure": [
    { "path": "<monorepo-relative path>", "action": "create|modify", "purpose": "<one line>" }
  ],
  "tasks": [
    {
      "title": "<task title>",
      "testFirst": "<how to verify before implementing>",
      "implement": "<exact change with specific file paths and patterns to follow>",
      "verify": "<how to confirm the task worked>"
    }
  ]
}

CRITICAL RULES:
- ALL paths MUST be monorepo-relative: "apps/web/...", "packages/db/...", NOT "lib/..." or "src/..."
- ONLY use paths from the VERIFIED FILES section below for "modify" actions. Do NOT invent paths.
- For "create" actions, use the same directory as the nearest related existing file.
- Each task MUST have: title, testFirst, implement, verify
- implement MUST reference specific existing files/patterns (e.g. "follow pattern in apps/web/lib/actions/build.ts")
- Tasks should be 2-5 minutes of work each — atomic, bite-sized. ONE specific file operation per task.
- NEVER combine multiple file edits or a test + implementation in one task
- A task that says "create file X AND update file Y" is TWO tasks
- A task that builds a test harness AND implements the feature is TWO tasks
- Include schema migration tasks if new DB models are needed (separate task each)
- Limit to 10 tasks maximum. If the feature needs more, scope down.
- Do NOT add boilerplate commentary — pure JSON only
${verifiedPaths && verifiedPaths.length > 0 ? `
VERIFIED FILES (CONFIRMED TO EXIST — use these exact paths for modify actions):
${verifiedPaths.map(p => `- ${p}`).join("\n")}
` : ""}
Respond with ONLY the JSON object, no markdown fences, no explanation.`;
}

/**
 * Robustly parse the plan JSON from portal-inference output.
 *
 * The model occasionally wraps the JSON in prose/markdown fences, or — on a
 * large plan — truncates mid-array when it hits its output ceiling. A bare
 * JSON.parse then fails and (before this) silently stalled the build in `plan`.
 * Strategy: markdown code-block → first-brace…last-brace slice → raw. Returns
 * null when no strategy yields a parseable object; the caller then RETRIES the
 * generation (which recovers truncation — a fresh, complete response).
 */
export function parsePlanJson(
  output: string,
): { fileStructure?: unknown[]; tasks?: unknown[] } | null {
  const tryParse = (text: string): { fileStructure?: unknown[]; tasks?: unknown[] } | null => {
    const t = text.trim();
    if (!t) return null;
    try {
      const parsed = JSON.parse(t);
      // A plan is a JSON object, never an array or scalar.
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  // 1. Markdown code block (```json … ``` or ``` … ```).
  const fence = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    const r = tryParse(fence[1]!);
    if (r) return r;
  }
  // 2. Bare object: first "{" to last "}" (strips surrounding prose).
  const first = output.indexOf("{");
  const last = output.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const r = tryParse(output.slice(first, last + 1));
    if (r) return r;
  }
  // 3. Raw.
  return tryParse(output);
}

/**
 * Generate + parse + validate + normalize a plan via portal inference, with the
 * existing bounded JSON-parse retry. `priorReviewIssues` (BI-99B06AD1) feeds a
 * failed review's blocking issues back so the model produces a REVISED plan that
 * resolves them. Returns the normalized plan or a human-readable error.
 */
async function generateNormalizedPlan(args: {
  title: string;
  designDoc: Record<string, unknown>;
  biTitle: string | null;
  biBody: string | null;
  verifiedPaths: string[];
  priorReviewIssues?: ReadonlyArray<PlanReviewIssue>;
  /** EP-MODEL-TIER-ROUTING: capability tier for plan generation. */
  modelTier?: "local" | "robust";
  /** FeatureBuild this generation belongs to — threaded into AdapterRunTelemetry
   *  so completeBuildPhaseRun can meter the plan phase (BI-0A6B8B38). */
  buildId?: string;
  log: (summary: string) => Promise<void>;
}): Promise<{ plan: { fileStructure?: unknown[]; tasks?: unknown[] } } | { error: string }> {
  const { routeAndCall } = await import("@/lib/inference/routed-inference");
  const prompt = buildPlanGenerationPrompt({
    title: args.title,
    designDoc: args.designDoc,
    biTitle: args.biTitle,
    biBody: args.biBody,
    verifiedPaths: args.verifiedPaths,
    priorReviewIssues: args.priorReviewIssues,
  });

  const PLAN_GEN_MAX_ATTEMPTS = 2;
  let planObj: { fileStructure?: unknown[]; tasks?: unknown[] } | null = null;
  // BI-7AD0759A: an endpoint that just returned unparseable JSON is the least
  // likely to return parseable JSON to the same prompt. Retrying it changes
  // nothing but the wall-clock. Deny it on the next attempt so routing picks a
  // different endpoint — live repro FB-62D7C0EC, where both attempts drew the
  // local model, both truncated mid-array, and the build was lost while a
  // capable endpoint sat unused.
  let deniedProviders: string[] = [];
  for (let attempt = 1; attempt <= PLAN_GEN_MAX_ATTEMPTS && !planObj; attempt++) {
    const denial = denialForNextAttempt(deniedProviders);
    const systemPrompt =
      attempt === 1
        ? "You are a senior software engineer creating a precise, actionable implementation plan. Respond with ONLY valid JSON."
        : "Your previous response was not valid JSON — it was likely truncated mid-array or wrapped in prose. Respond with ONLY the COMPLETE, valid JSON object (both the fileStructure and tasks arrays fully closed). No prose, no markdown fences.";
    const response = await routeAndCall(
      [{ role: "user" as const, content: prompt }],
      systemPrompt,
      "internal",
      {
        budgetClass: "quality_first",
        ...(args.modelTier ? { modelTier: args.modelTier } : {}),
        ...(args.buildId ? { buildId: args.buildId } : {}),
        // Empty on the first attempt; carries the endpoints that already failed
        // to produce parseable JSON on later ones. If every endpoint is denied,
        // routing falls back rather than refusing — the platform must stay
        // runnable (BI-3B3F477B).
        ...(denial ? { deniedProviders: denial } : {}),
      },
    );
    planObj = parsePlanJson(response.content);
    if (!planObj) {
      await args.log(
        `Plan generation attempt ${attempt}/${PLAN_GEN_MAX_ATTEMPTS} returned unparseable JSON` +
          (attempt < PLAN_GEN_MAX_ATTEMPTS ? " — retrying" : ""),
      );
      // BI-7AD0759A: keep what the model actually said. "Unparseable JSON" is
      // not a diagnosis — truncated mid-array, wrapped in prose and returned
      // nothing are three different failures with three different fixes, and
      // discarding the response made them indistinguishable on the install
      // where it matters most. Bounded excerpt, both ends kept, because a
      // truncated object fails at the END.
      const { excerptHeadAndTail } = await import("@/lib/build/ideate-output-excerpt");
      const raw = (response.content ?? "").trim();
      await args.log(
        raw.length === 0
          ? `Plan output excerpt (${response.providerId}): the model returned no output at all.`
          : `Plan output excerpt (${response.providerId}, ${raw.length} chars): ${excerptHeadAndTail(raw)}`,
      );
      deniedProviders = denyAfterUnparseable(deniedProviders, response.providerId);
    }
  }

  if (!planObj) return { error: `Plan generation returned unparseable JSON after ${PLAN_GEN_MAX_ATTEMPTS} attempts` };
  if (!Array.isArray(planObj.fileStructure) || !Array.isArray(planObj.tasks)) return { error: "Plan JSON missing fileStructure or tasks arrays" };
  if (planObj.tasks.length === 0) return { error: "Plan generation returned 0 tasks" };

  const normalized = normalizeBuildPlanPaths(planObj as Parameters<typeof normalizeBuildPlanPaths>[0]);
  return { plan: normalized.plan };
}

/** Read the persisted planReview decision + issues after a reviewBuildPlan run. */
async function readPlanReview(buildId: string): Promise<{ decision: string; issues: PlanReviewIssue[] } | null> {
  const row = await prisma.featureBuild.findUnique({ where: { buildId }, select: { planReview: true } }).catch(() => null);
  const pr = row?.planReview as { decision?: string; issues?: PlanReviewIssue[] } | null;
  if (!pr || typeof pr.decision !== "string") return null;
  return { decision: pr.decision, issues: Array.isArray(pr.issues) ? pr.issues : [] };
}

/** Run reviewBuildPlan (dual reviewers + gate + auto-advance-on-pass) for a build. */
async function runPlanReview(buildId: string, userId: string, log: (s: string) => Promise<void>): Promise<void> {
  try {
    const { executeTool } = await import("@/lib/mcp-tools");
    const reviewResult = await executeTool(
      "reviewBuildPlan",
      { buildId },
      userId,
      { featureBuildId: buildId, suppressPlanReviewAutoRepair: true },
    );
    const reviewSummary = typeof reviewResult.message === "string" ? reviewResult.message.slice(0, 200) : "review complete";
    await log(`Auto-reviewBuildPlan: ${reviewSummary}`);
  } catch (reviewErr) {
    await log(`Auto-reviewBuildPlan failed (plan still saved): ${String(reviewErr).slice(0, 200)}`);
  }
}

/**
 * Auto-dispatch Plan-phase implementation-plan generation for a build that just
 * advanced from ideate → plan. Designed to be called fire-and-forget from the
 * reviewDesignDoc success path; never throws.
 */
export async function dispatchPlanForApprovedBuild(params: {
  buildId: string;
  userId: string;
  /** Local-tuning: when a build is RESUMED with an existing plan that already
   *  FAILED review, bypass the idempotency guard so the BI-99B06AD1 fix loop
   *  regenerates it (with a fresh verified-paths search) instead of re-reviewing
   *  the same bad plan forever. The resume path passes this on a failed planReview. */
  forceRegenerate?: boolean;
}): Promise<PlanDispatchOutcome> {
  const { buildId, userId, forceRegenerate = false } = params;
  const t0 = Date.now();

  const log = (summary: string) =>
    logBuildActivity(buildId, "plan_dispatch", summary);

  try {
    // 1. Fetch build state.
    const build = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: {
        id: true,
        phase: true,
        title: true,
        description: true,
        buildPlan: true,
        designDoc: true,
        kind: true,
        originatingBacklogItemId: true,
      },
    });

    if (!build) {
      await log(`Build not found: ${buildId}`);
      return { kind: "dispatched-failure", error: "Build not found", durationMs: Date.now() - t0 };
    }

    if (build.phase !== "plan") {
      await log(`Skipped — phase is ${build.phase}, expected plan`);
      return { kind: "skipped-wrong-phase", reason: `phase=${build.phase}` };
    }

    if (!build.designDoc) {
      await log("Skipped — no design doc");
      return { kind: "skipped-no-design-doc", reason: "designDoc is null" };
    }

    // Idempotency guard — skipped when forceRegenerate (a resume of a build whose
    // existing plan FAILED review), so the fix loop below repairs it rather than
    // the dispatch short-circuiting and the build re-failing the same review.
    const existingPlan = build.buildPlan as { tasks?: unknown[] } | null;
    if (!forceRegenerate && existingPlan?.tasks && Array.isArray(existingPlan.tasks) && existingPlan.tasks.length > 0) {
      await log("Skipped — buildPlan already present");
      return { kind: "skipped-already-has-plan", reason: "buildPlan already saved" };
    }
    if (forceRegenerate && existingPlan?.tasks?.length) {
      await log("Resume: existing plan failed review — regenerating with the fix loop.");
    }

    // 2. Fetch BI context for richer prompt.
    let biTitle: string | null = null;
    let biBody: string | null = null;
    let biEffortSize: string | null = null;
    if (build.originatingBacklogItemId) {
      const bi = await prisma.backlogItem.findUnique({
        where: { id: build.originatingBacklogItemId },
        select: { title: true, body: true, effortSize: true },
      }).catch(() => null);
      biTitle = bi?.title ?? null;
      biBody = bi?.body ?? null;
      biEffortSize = bi?.effortSize ?? null;
    }

    // EP-MODEL-TIER-ROUTING: route plan generation by the build's tier.
    // BI-B24D4C84: pass the rightsizing opts (as the autonomous callers do) so
    // this takes the quality-first branch rather than the legacy size-only one,
    // which pinned every small/medium build to the local tier.
    const { getModelTier, deriveDeliverableSensitivity } = await import("@/lib/explore/build-process-matrix");
    const { isModelTierRoutingEnabled, isQualityFirstRightsizingEnabled } = await import("./build-studio-config");
    const planSensitivity = deriveDeliverableSensitivity({
      text: `${build.title ?? ""}\n${build.description ?? ""}`,
      workType: build.kind,
    });
    const planQualityFirst = await isQualityFirstRightsizingEnabled();
    const planModelTier = (await isModelTierRoutingEnabled())
      ? getModelTier(build.kind, biEffortSize, {
          qualityFirst: planQualityFirst,
          sensitivity: planSensitivity,
        })
      : undefined;

    // 2b. Search the codebase for files related to the build to give the plan
    //     LLM verified paths rather than hallucinated ones. This is the single
    //     most important quality improvement for plan generation.
    let verifiedPaths: string[] = [];
    try {
      const { searchProjectFiles } = await import("@/lib/build/codebase-tools");
      const dd = build.designDoc as Record<string, unknown>;
      // Extract CamelCase terms from the design doc — likely component/class names
      const allText = [
        build.title,
        String(dd.proposedApproach ?? ""),
        String(dd.existingCodeAudit ?? dd.existingFunctionalityAudit ?? ""),
        String(dd.reusePlan ?? ""),
      ].join(" ");
      const camelTerms = (allText.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) ?? [])
        .filter((t, i, a) => a.indexOf(t) === i) // dedupe
        .slice(0, 4);

      const pathSet = new Set<string>();
      for (const term of camelTerms) {
        const result = await searchProjectFiles(term, { maxResults: 5 });
        if ("results" in result) {
          result.results.forEach(r => pathSet.add(r.path));
        }
      }
      verifiedPaths = [...pathSet]
        .filter(p => (p.startsWith("apps/") || p.startsWith("packages/")) && !p.includes("node_modules"))
        .slice(0, 20);
    } catch {
      // Non-fatal — proceed without path verification
    }

    await log("Dispatching plan generation via portal inference");

    // 3-7. Generate the initial plan (helper handles parse-retry + validate + normalize).
    const gen = await generateNormalizedPlan({
      buildId,
      title: build.title,
      designDoc: build.designDoc as Record<string, unknown>,
      biTitle,
      biBody,
      verifiedPaths,
      modelTier: planModelTier,
      log,
    });
    if ("error" in gen) {
      await log(gen.error);
      return { kind: "dispatched-failure", error: gen.error, durationMs: Date.now() - t0 };
    }
    let plan = gen.plan;
    await prisma.featureBuild.update({
      where: { buildId },
      data: { buildPlan: plan as unknown as import("@dpf/db").Prisma.InputJsonValue, updatedAt: new Date() },
    });
    await log(`Plan generated: ${plan.tasks?.length ?? 0} tasks across ${plan.fileStructure?.length ?? 0} files`);

    // 8. Review the plan (dual reviewers; auto-advances plan→build on pass).
    await runPlanReview(buildId, userId, log);

    // 9. BI-99B06AD1 — verification→fix loop. If the review FAILED, don't leave the
    //    build stuck with a rejected plan (which then resume-restalls forever — the
    //    live root cause of WIP-jamming stranded builds). Feed the reviewer's
    //    blocking issues back into a bounded plan REVISION, re-review, and escalate
    //    to a human if it still can't pass — instead of churning indefinitely.
    const PLAN_FIX_MAX_ROUNDS = Number(process.env.PLAN_FIX_MAX_ROUNDS) || 2;
    let review = await readPlanReview(buildId);
    let round = 0;
    // BI-E492F313: did any round actually produce a revised plan to review? A
    // revision that never ran is NOT self-repair exhausted, and must not be
    // treated as one.
    let regenerated = false;
    while (review?.decision === "fail" && round < PLAN_FIX_MAX_ROUNDS) {
      round++;
      await log(`Plan review failed — revising (round ${round}/${PLAN_FIX_MAX_ROUNDS}) against ${review.issues.length} blocking issue(s)`);
      const revised = await generateNormalizedPlan({
        buildId,
        title: build.title,
        designDoc: build.designDoc as Record<string, unknown>,
        biTitle,
        biBody,
        verifiedPaths,
        priorReviewIssues: review.issues,
        modelTier: planModelTier,
        log,
      });
      if ("error" in revised) {
        // BI-E492F313: this used to `break`, so ONE generation failure both
        // consumed a round and abandoned the rest. A revision that could not be
        // produced says nothing about the plan, so spend the remaining rounds —
        // routing is re-resolved per attempt and a later round can land on an
        // endpoint that completes the JSON. Live repro FB-62D7C0EC.
        await log(`Plan revision round ${round} failed: ${revised.error} — retrying if rounds remain.`);
        continue;
      }
      regenerated = true;
      plan = revised.plan;
      await prisma.featureBuild.update({
        where: { buildId },
        data: { buildPlan: plan as unknown as import("@dpf/db").Prisma.InputJsonValue, updatedAt: new Date() },
      });
      await log(`Revised plan: ${plan.tasks?.length ?? 0} tasks across ${plan.fileStructure?.length ?? 0} files`);
      await runPlanReview(buildId, userId, log);
      review = await readPlanReview(buildId);
    }

    // BI-E492F313 — the same rule the design loop uses (review-fix-outcome.ts):
    // escalation ABANDONS the build and parks the owner's backlog item, which is
    // right for a plan the platform could not repair and wrong for "no endpoint
    // produced a plan to review". Live repro FB-62D7C0EC: plan generation
    // returned unparseable JSON on both attempts and the build was destroyed,
    // taking a plan review that had named five critical issues plus an
    // architecture advisory with it.
    const { resolveReviewFixOutcome, outcomeKeepsBuildRecoverable } = await import(
      "@/lib/build/review-fix-outcome"
    );
    const fixOutcome = resolveReviewFixOutcome({
      reviewFailed: review?.decision === "fail",
      regenerated,
    });

    if (outcomeKeepsBuildRecoverable(fixOutcome)) {
      await log(
        `Plan repair could not generate a plan in ${round} round(s) — no endpoint produced one. `
        + "Leaving the build recoverable; the existing plan and review are kept.",
      );
      return {
        kind: "dispatched-failure",
        error: "blocked-no-regeneration",
        durationMs: Date.now() - t0,
      };
    }

    if (fixOutcome === "escalated-after-rounds" && review) {
      // Bounded revisions exhausted — Build Studio cannot self-repair this plan.
      // Escalate to a human (BI-3E0EE3BA): capture a durable issue report (which
      // auto-surfaces via intake), free the WIP slot (abandon the build), and
      // park the backlog item as "deferred" so it is never lost AND does not
      // resume-restall into the same failure. This is the honest stop.
      await escalateBuildToHuman({
        buildPk: build.id,
        buildId,
        featureTitle: build.title,
        biTitle,
        originatingBacklogItemId: build.originatingBacklogItemId,
        phase: "plan",
        rounds: round,
        issues: review.issues,
        selfFixClass: SELF_FIX_CLASS.NEEDS_HUMAN,
        log,
      });
      return { kind: "dispatched-failure", error: "escalated-to-human", durationMs: Date.now() - t0 };
    }

    return {
      kind: "dispatched-success",
      taskCount: plan.tasks?.length ?? 0,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).slice(0, 300);
    try { await log(`Plan dispatch failed: ${msg}`); } catch (_) { /**/ }
    return { kind: "dispatched-failure", error: msg, durationMs: Date.now() - t0 };
  }
}
