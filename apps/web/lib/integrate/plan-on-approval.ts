// apps/web/lib/integrate/plan-on-approval.ts
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
import { normalizeBuildPlanPaths } from "./build-plan-paths";

function logBuildActivity(buildId: string, tool: string, summary: string): Promise<void> {
  return prisma.buildActivity.create({ data: { buildId, tool, summary } }).then(() => void 0).catch(() => void 0);
}

type PlanDispatchOutcome =
  | { kind: "skipped-no-design-doc"; reason: string }
  | { kind: "skipped-already-has-plan"; reason: string }
  | { kind: "skipped-wrong-phase"; reason: string }
  | { kind: "dispatched-success"; taskCount: number; durationMs: number }
  | { kind: "dispatched-failure"; error: string; durationMs: number };

/** Build the plan-generation prompt from the design doc. */
function buildPlanGenerationPrompt(params: {
  title: string;
  designDoc: Record<string, unknown>;
  biTitle: string | null;
  biBody: string | null;
  verifiedPaths?: string[];  // actual paths confirmed to exist in the codebase
}): string {
  const { title, designDoc, biTitle, biBody, verifiedPaths } = params;
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
- Tasks should be 2-5 minutes of work each — atomic, bite-sized
- Include schema migration tasks if new DB models are needed
- Do NOT add boilerplate commentary — pure JSON only
${verifiedPaths && verifiedPaths.length > 0 ? `
VERIFIED FILES (CONFIRMED TO EXIST — use these exact paths for modify actions):
${verifiedPaths.map(p => `- ${p}`).join("\n")}
` : ""}
Respond with ONLY the JSON object, no markdown fences, no explanation.`;
}

/**
 * Auto-dispatch Plan-phase implementation-plan generation for a build that just
 * advanced from ideate → plan. Designed to be called fire-and-forget from the
 * reviewDesignDoc success path; never throws.
 */
export async function dispatchPlanForApprovedBuild(params: {
  buildId: string;
  userId: string;
}): Promise<PlanDispatchOutcome> {
  const { buildId, userId } = params;
  const t0 = Date.now();

  const log = (summary: string) =>
    logBuildActivity(buildId, "plan_dispatch", summary);

  try {
    // 1. Fetch build state.
    const build = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: {
        phase: true,
        title: true,
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

    // Idempotency guard.
    const existingPlan = build.buildPlan as { tasks?: unknown[] } | null;
    if (existingPlan?.tasks && Array.isArray(existingPlan.tasks) && existingPlan.tasks.length > 0) {
      await log("Skipped — buildPlan already present");
      return { kind: "skipped-already-has-plan", reason: "buildPlan already saved" };
    }

    // 2. Fetch BI context for richer prompt.
    let biTitle: string | null = null;
    let biBody: string | null = null;
    if (build.originatingBacklogItemId) {
      const bi = await prisma.backlogItem.findUnique({
        where: { id: build.originatingBacklogItemId },
        select: { title: true, body: true },
      }).catch(() => null);
      biTitle = bi?.title ?? null;
      biBody = bi?.body ?? null;
    }

    // 2b. Search the codebase for files related to the build to give the plan
    //     LLM verified paths rather than hallucinated ones. This is the single
    //     most important quality improvement for plan generation.
    let verifiedPaths: string[] = [];
    try {
      const { searchProjectFiles } = await import("@/lib/integrate/codebase-tools");
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

    // 3. Generate plan via portal-side LLM (no CLI needed for plan generation).
    const { routeAndCall } = await import("@/lib/inference/routed-inference");
    const prompt = buildPlanGenerationPrompt({
      title: build.title,
      designDoc: build.designDoc as Record<string, unknown>,
      biTitle,
      biBody,
      verifiedPaths,
    });

    const response = await routeAndCall(
      [{ role: "user" as const, content: prompt }],
      "You are a senior software engineer creating a precise, actionable implementation plan. Respond with ONLY valid JSON.",
      "internal",
      { budgetClass: "quality_first" },
    );

    // 4. Parse JSON.
    const rawContent = response.content.trim();
    // Strip optional markdown fences.
    const jsonStr = rawContent.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

    let planObj: { fileStructure?: unknown[]; tasks?: unknown[] };
    try {
      planObj = JSON.parse(jsonStr);
    } catch (parseErr) {
      const msg = `Plan generation returned unparseable JSON: ${String(parseErr).slice(0, 200)}`;
      await log(msg);
      return { kind: "dispatched-failure", error: msg, durationMs: Date.now() - t0 };
    }

    // 5. Validate structure.
    if (!Array.isArray(planObj.fileStructure) || !Array.isArray(planObj.tasks)) {
      const msg = "Plan JSON missing fileStructure or tasks arrays";
      await log(msg);
      return { kind: "dispatched-failure", error: msg, durationMs: Date.now() - t0 };
    }
    if (planObj.tasks.length === 0) {
      const msg = "Plan generation returned 0 tasks";
      await log(msg);
      return { kind: "dispatched-failure", error: msg, durationMs: Date.now() - t0 };
    }

    // 6. Normalize paths (monorepo-relative guard).
    const normalized = normalizeBuildPlanPaths(planObj as Parameters<typeof normalizeBuildPlanPaths>[0]);

    // 7. Persist as buildPlan evidence.
    await prisma.featureBuild.update({
      where: { buildId },
      data: {
        buildPlan: normalized.plan as unknown as import("@dpf/db").Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
    await log(`Plan generated: ${normalized.plan.tasks?.length ?? 0} tasks across ${normalized.plan.fileStructure?.length ?? 0} files`);

    // 8. Auto-reviewBuildPlan — this already handles: dual reviewers, gate check,
    //    and auto-advance plan→build if the plan passes. We call it directly through
    //    the MCP executeTool path so the full reviewer + deliberation pipeline runs.
    //    We pass a synthetic context with a stable system thread ID for event bus routing.
    try {
      const { executeTool } = await import("@/lib/mcp-tools");
      const reviewResult = await executeTool(
        "reviewBuildPlan",
        { buildId },
        userId,
        { featureBuildId: buildId }, // routes to correct build
      );
      const reviewSummary = typeof reviewResult.message === "string"
        ? reviewResult.message.slice(0, 200)
        : "review complete";
      await log(`Auto-reviewBuildPlan: ${reviewSummary}`);
    } catch (reviewErr) {
      // reviewBuildPlan failure is non-fatal for the dispatch — the plan is saved
      // and the reviewer can be re-run manually from the build chat.
      await log(`Auto-reviewBuildPlan failed (plan still saved): ${String(reviewErr).slice(0, 200)}`);
    }

    return {
      kind: "dispatched-success",
      taskCount: normalized.plan.tasks?.length ?? 0,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).slice(0, 300);
    try { await log(`Plan dispatch failed: ${msg}`); } catch (_) { /**/ }
    return { kind: "dispatched-failure", error: msg, durationMs: Date.now() - t0 };
  }
}
