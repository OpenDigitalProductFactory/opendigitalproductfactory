// Build-review tool handlers — Simplify & Strengthen W9 (BI-0E7B0953).
//
// Two of the last three inline executeTool cases from the mcp-tools.ts legacy
// monolith: saving build evidence and the plan-review gate (the design-review
// gate lives in the sibling build-design-review-handler.ts so neither module
// exceeds the new-file size ceiling). Each function reproduces its former
// switch case verbatim — same lazy imports, same branches, same return shapes —
// so behaviour is identical over MCP. The only structural change is the error
// boundary: executeTool's shared try/catch used to convert an uncaught
// exception into a failure ToolResult, so each handler carries that same
// boundary locally (pack handlers dispatch outside executeTool's try/catch by
// design — see the pack-registry dispatch note in mcp-tools.ts).

import { prisma } from "@dpf/db";
import { ENTERPRISE_ARCHITECT_DISPLAY_NAME } from "@dpf/db/agent-identity";

import type { ToolResult } from "@/lib/mcp-tools";
import type { ToolPackHandler } from "./tool-pack";
import {
  logBuildActivity,
  extractBuildIdHint,
  resolveActiveBuildId,
} from "@/lib/mcp/build-tool-helpers";
import type { ReviewBranchInput } from "@/lib/build/build-reviewers";
import { triggerPlanReviewAutoRepair } from "@/lib/build/pre-build-review-auto-repair";
import { normalizeBuildPlanPaths } from "@/lib/build/build-plan-paths";
import { getErrorMessage } from "@/lib/shared/get-error-message";

type HandlerContext = Parameters<ToolPackHandler>[2];

/** Mirror of executeTool's catch arm, applied per handler so a thrown error
 *  still becomes a failure ToolResult instead of a transport-level rejection. */
export function toFailureResult(toolName: string, err: unknown): ToolResult {
  const msg = getErrorMessage(err);
  // CodeQL js/tainted-format-string + js/log-injection: constant format
  // string; JSON.stringify the interpolated values (same as executeTool).
  console.error("[executeTool] Uncaught exception in tool %s: %s",
    JSON.stringify(toolName), JSON.stringify(msg));
  return { success: false, error: msg, message: `Tool ${toolName} failed: ${msg}` };
}

export async function saveBuildEvidence(params: Record<string, unknown>, userId: string, context?: HandlerContext): Promise<ToolResult> {
  try {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build found.", message: "No active build." };
      const field = String(params.field ?? "");
      const allowedFields = ["designDoc", "designReview", "buildPlan", "planReview", "taskResults", "verificationOut", "acceptanceMet", "scoutFindings"];
      if (!allowedFields.includes(field)) return { success: false, error: `Invalid field: ${field}`, message: `Field must be one of: ${allowedFields.join(", ")}` };
      const topLevelValue = Object.fromEntries(
        Object.entries(params).filter(([key]) => key !== "field" && key !== "value"),
      );
      let normalizedValue =
        params.value !== undefined
          ? params.value
          : Object.keys(topLevelValue).length > 0
            ? topLevelValue
            : undefined;

      if (normalizedValue === undefined || normalizedValue === null) {
        return {
          success: false,
          error: "Missing value.",
          message: `REJECTED: saveBuildEvidence requires a non-null "value" object. For field "${field}", pass a JSON object — e.g. for designDoc: {problemStatement, existingFunctionalityAudit, reusePlan, proposedApproach, acceptanceCriteria[]}.`,
        };
      }

      // Guide the agent when it saves the wrong field for the current phase
      const currentBuildForPhaseCheck = await prisma.featureBuild.findUnique({ where: { buildId }, select: { phase: true } });
      if (currentBuildForPhaseCheck?.phase === "plan" && field === "designDoc") {
        return { success: true, message: 'Design doc updated. IMPORTANT: You are in the PLAN phase. To advance to Build, save the implementation plan using saveBuildEvidence with field "buildPlan" (not "designDoc"). The buildPlan must contain { fileStructure, tasks } arrays.', entityId: buildId };
      }

      // ── designDoc quality gate ──────────────────────────────────────────
      // Reject design docs that skip codebase research — they lead to builds
      // with wrong auth patterns, wrong field names, and wrong imports.
      // Accept "no existing code found" as valid research for new features.
      // When updating an existing doc (revising for review feedback), auto-merge
      // the audit from the saved doc so the coworker doesn't loop retrying.
      if (field === "designDoc") {
        const doc = normalizedValue as Record<string, unknown> | null;
        const audit = String(doc?.existingCodeAudit ?? doc?.existingFunctionalityAudit ?? "");
        if (!audit || audit.length < 20) {
          // Check whether the build already has a valid audit saved — if so,
          // carry it forward rather than forcing a full re-research on revision.
          const existing = await prisma.featureBuild.findUnique({
            where: { buildId },
            select: { designDoc: true },
          });
          const existingDoc = existing?.designDoc as Record<string, unknown> | null;
          const existingAudit = String(
            existingDoc?.existingCodeAudit ?? existingDoc?.existingFunctionalityAudit ?? ""
          );
          if (existingAudit.length >= 20) {
            // Carry forward the existing audit so the revision can be saved.
            normalizedValue = {
              ...doc,
              existingFunctionalityAudit: existingAudit,
            };
          } else {
            return {
              success: false,
              error: "Design doc missing codebase research.",
              message: "REJECTED: existingCodeAudit is empty or too short. Research the codebase first with search_project_files and describe_model. If this is a new feature with no existing code, write 'No existing implementation found. Searched for [terms]. This is a new feature.' — that counts as valid research.",
            };
          }
        }

        // Reject docs that use wrong field names for the required text fields.
        // Common mistake: agent passes {summary, approach} from stale prompt examples
        // instead of {problemStatement, proposedApproach}. The review prompt inlines
        // these via template literals, so a missing field renders as the string
        // "undefined" in the review input and the review always fails.
        const docAfterAudit = normalizedValue as Record<string, unknown>;
        const problemStatement = docAfterAudit?.problemStatement;
        const proposedApproach = docAfterAudit?.proposedApproach;
        const reusePlan = docAfterAudit?.reusePlan;
        if (typeof problemStatement !== "string" || problemStatement.trim().length < 5) {
          return {
            success: false,
            error: "designDoc missing problemStatement.",
            message: `REJECTED: designDoc must have a non-empty "problemStatement" field (string, min 5 chars). Common mistake: you passed "summary" or "problem" — the correct key is "problemStatement". Required shape: {problemStatement, existingFunctionalityAudit, reusePlan, proposedApproach, acceptanceCriteria[]}`,
          };
        }
        if (typeof proposedApproach !== "string" || proposedApproach.trim().length < 5) {
          return {
            success: false,
            error: "designDoc missing proposedApproach.",
            message: `REJECTED: designDoc must have a non-empty "proposedApproach" field (string, min 5 chars). Common mistake: you passed "approach" or "solution" — the correct key is "proposedApproach". Required shape: {problemStatement, existingFunctionalityAudit, reusePlan, proposedApproach, acceptanceCriteria[]}`,
          };
        }
        if (typeof reusePlan !== "string" || reusePlan.trim().length < 3) {
          return {
            success: false,
            error: "designDoc missing reusePlan.",
            message: `REJECTED: designDoc must have a non-empty "reusePlan" field. State which existing code/patterns will be reused, or write "No reuse applicable — new standalone feature."`,
          };
        }
      }

      // ── buildPlan format validation ──────────────────────────────────────
      // The build orchestrator reads buildPlan.fileStructure and buildPlan.tasks
      // to dispatch specialist agents. If the format is wrong, the orchestrator
      // silently falls back to a single agent doing everything — no data architect,
      // no frontend engineer, no QA. Reject malformed plans early.
      if (field === "buildPlan") {
        // Unwrap if agent nested: { buildPlan: { fileStructure, tasks } }
        let plan = normalizedValue as Record<string, unknown> | null;
        if (plan && !plan.fileStructure && !plan.tasks && plan.buildPlan && typeof plan.buildPlan === "object") {
          // The unwrap flows forward through `plan`; normalizedValue is
          // reassigned from normalizeBuildPlanPaths(plan) below on every
          // non-returning path.
          plan = plan.buildPlan as Record<string, unknown>;
        }
        const fileStructure = plan?.fileStructure;
        const tasks = plan?.tasks;

        if (!plan || typeof plan !== "object") {
          return { success: false, error: "buildPlan must be a JSON object.", message: "The buildPlan value must be a JSON object with fileStructure and tasks arrays." };
        }

        if (!Array.isArray(fileStructure) || fileStructure.length === 0) {
          const hint = `Got keys: ${Object.keys(plan).join(", ")}`;
          return {
            success: false,
            error: "buildPlan missing fileStructure array.",
            message: `REJECTED: buildPlan must have a "fileStructure" array listing files to create/modify. ${hint}. Required format: { "fileStructure": [{ "path": "...", "action": "create"|"modify", "purpose": "..." }], "tasks": [{ "title": "...", "testFirst": "...", "implement": "...", "verify": "..." }] }`,
          };
        }

        if (!Array.isArray(tasks) || tasks.length === 0) {
          return {
            success: false,
            error: "buildPlan missing tasks array.",
            message: `REJECTED: buildPlan must have a "tasks" array listing implementation steps. Required format: { "fileStructure": [...], "tasks": [{ "title": "...", "testFirst": "...", "implement": "...", "verify": "..." }] }`,
          };
        }

        // Validate task shape
        const firstTask = tasks[0] as Record<string, unknown>;
        if (!firstTask?.title) {
          return {
            success: false,
            error: "buildPlan tasks must have title fields.",
            message: `REJECTED: Each task needs at minimum a "title" field. Got: ${JSON.stringify(Object.keys(firstTask ?? {}))}.`,
          };
        }

        // Validate that every fileStructure entry has a path field — missing paths
        // cause normalizeBuildPlanPaths to crash with "Cannot read properties of
        // undefined (reading 'trim')".
        const missingPathEntries = (fileStructure as Array<Record<string, unknown>>)
          .map((e, i) => ({ i, path: e["path"] }))
          .filter(({ path }) => !path || typeof path !== "string");
        if (missingPathEntries.length > 0) {
          return {
            success: false,
            error: "buildPlan fileStructure entries must all have a path field.",
            message: `REJECTED: ${missingPathEntries.length} fileStructure entries are missing a "path" field (indices: ${missingPathEntries.map(({ i }) => i).join(", ")}). Every entry must have { "path": "apps/web/...", "action": "create"|"modify", "purpose": "..." }.`,
          };
        }

        const normalizedPlan = normalizeBuildPlanPaths(plan as Parameters<typeof normalizeBuildPlanPaths>[0]);
        if (normalizedPlan.unresolvedModifyPaths.length > 0) {
          return {
            success: false,
            error: "buildPlan modify targets must exist in the current repo.",
            message: `REJECTED: The build plan tries to modify file paths that do not exist in this repo: ${normalizedPlan.unresolvedModifyPaths.join(", ")}. Re-read the current codebase and save the buildPlan again using real monorepo-relative paths.`,
          };
        }
        normalizedValue = normalizedPlan.plan;

        // CodeQL js/log-injection: .length is numeric so safe, but CodeQL
        // tracks the parent array as tainted. Number() coercion is a
        // recognised sanitiser.
        console.log(`[saveBuildEvidence] buildPlan validated: ${Number(fileStructure.length)} files, ${Number(tasks.length)} tasks`);
      }

      // ── taskResults shape validation ─────────────────────────────────────
      // The orchestrator's canonical shape carries tasks as
      //   Array<{ title: string, specialist: string, outcome?: string, durationMs?: number }>.
      // Other legitimate writers (post-build summaries, contributionAssessment)
      // omit `tasks` entirely. Reject any write where `tasks` is present but
      // its entries lack the required string fields — that's the failure mode
      // that crashes the Build Studio process graph downstream.
      if (field === "taskResults") {
        const value = normalizedValue;
        if (value != null && typeof value === "object" && "tasks" in value) {
          const tasksField = (value as { tasks?: unknown }).tasks;
          if (!Array.isArray(tasksField)) {
            return {
              success: false,
              error: "taskResults.tasks must be an array.",
              message: `REJECTED: taskResults contained a "tasks" key that wasn't an array. Either omit "tasks" (for summary-only writes) or provide an array of { title, specialist, outcome, durationMs? } entries.`,
            };
          }
          for (let i = 0; i < tasksField.length; i++) {
            const entry = tasksField[i];
            const title = (entry as { title?: unknown } | null)?.title;
            const specialist = (entry as { specialist?: unknown } | null)?.specialist;
            if (typeof title !== "string" || typeof specialist !== "string") {
              const got = entry == null ? "null" : `keys: ${Object.keys(entry as object).join(", ")}`;
              return {
                success: false,
                error: "taskResults.tasks entry missing title/specialist.",
                message: `REJECTED: taskResults.tasks[${i}] must have string "title" and "specialist" fields. Got ${got}. This shape is consumed by the Build Studio process graph; do not use taskResults to store backlog claim or triage summaries.`,
              };
            }
          }
        }
      }

      // When the AI saves verificationOut, ensure typecheckPassed is explicitly set.
      // The AI often omits it, causing the gate to treat null as false.
      let fieldValue = normalizedValue as Record<string, unknown>;
      if (field === "verificationOut" && typeof fieldValue === "object" && fieldValue !== null) {
        if (fieldValue.typecheckPassed === undefined || fieldValue.typecheckPassed === null) {
          fieldValue = { ...fieldValue, typecheckPassed: true };
          console.log("[saveBuildEvidence] Auto-set typecheckPassed=true (AI omitted it)");
        }
      }
      const updateData: Record<string, unknown> = { [field]: fieldValue as import("@dpf/db").Prisma.InputJsonValue };

      // Auto-populate brief from designDoc when saving during ideate phase.
      // The generate_code tool requires brief to build codegen prompts.
      // Derivation is honest-by-default (no fabricated portfolio/roles/ACs) —
      // see deriveAutoBriefFromDesignDoc.
      if (field === "designDoc") {
        const currentBuild = await prisma.featureBuild.findUnique({ where: { buildId }, select: { brief: true, title: true, phase: true } });
        if (currentBuild && !currentBuild.brief) {
          const doc = normalizedValue as Record<string, unknown> | null;
          const { deriveAutoBriefFromDesignDoc } = await import("@/lib/build/derive-auto-brief");
          updateData.brief = deriveAutoBriefFromDesignDoc(doc, currentBuild.title);
        }
      }

      const { saveBuildArtifactRevision } = await import("@/lib/build/build-artifact-provenance");
      const savedRevision = await saveBuildArtifactRevision({
        buildId,
        field: field as import("@/lib/build/build-artifact-provenance").BuildArtifactField,
        receiptIds: Array.isArray(params.receiptIds)
          ? params.receiptIds.filter((value): value is string => typeof value === "string")
          : [],
        savedByAgentId: context?.agentId ?? null,
        savedByUserId: userId,
        threadId: context?.threadId ?? null,
        value: fieldValue,
      });
      // BI-C5D978E9: record the research the ideate phase actually performed.
      // The readiness gate blocks ideate->plan on RESEARCH_REQUIRED and nothing
      // ever recorded it, so every owner-composed feature build stalled with the
      // research done and unrecorded (live repro FB-EB292B9F). The grant table
      // marks this lane author-accountable, independent: false — unlike
      // spec-approval and architecture-review, which still need an independent
      // reviewer and still block. Fail-safe: saving evidence must never break.
      if (field === "designDoc") {
        try {
          const { recordIdeateResearchReceipt } = await import("@/lib/build/record-ideate-research-receipt");
          await recordIdeateResearchReceipt({
            buildId,
            designDoc: fieldValue,
            revisionId: savedRevision.revisionId,
            authorUserId: userId,
            authorAgentId: context?.agentId ?? null,
          });
        } catch {
          // A missing receipt leaves the build exactly where it already was.
        }
      }
      if (field === "designDoc" && updateData.brief) {
        await prisma.featureBuild.update({
          where: { buildId },
          data: { brief: updateData.brief as import("@dpf/db").Prisma.InputJsonValue },
        });
      }
      // When taskResults is written via tool call, bump version for optimistic locking
      if (field === "taskResults") {
        await prisma.featureBuild.update({
          where: { buildId },
          data: { taskResultsVersion: { increment: 1 } },
        });
      }
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field });
      logBuildActivity(buildId, "saveBuildEvidence", `Evidence "${field}" saved.`);

      // Phase advancement is handled by explicit review tool handlers
      // (reviewDesignDoc, reviewBuildPlan) and advanceBuildPhase(), not here.
      // Removing auto-advance from saveBuildEvidence prevents accidental phase
      // transitions when evidence is saved before review completes.

      const savedLength = JSON.stringify(fieldValue).length;
      return { success: true, message: `Evidence "${field}" saved (${savedLength} chars). Do NOT call saveBuildEvidence again for this field unless you receive a review failure — the write is confirmed.`, entityId: buildId, data: { buildId, field, length: savedLength, saved: true } };
  } catch (err) {
    return toFailureResult("saveBuildEvidence", err);
  }
}

export async function reviewBuildPlan(params: Record<string, unknown>, userId: string, context?: HandlerContext): Promise<ToolResult> {
  try {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      // BI-4396EFEC (D38) — also load the prior planReview so we can pass
      // its issues to the reviewer prompt for delta-awareness and compute
      // the iteration trajectory for the operator-facing chip.
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { buildPlan: true, planReview: true, kind: true } });
      if (!build?.buildPlan) return { success: false, error: "No build plan saved yet.", message: "Save buildPlan first." };
      const priorPlanReview = (build.planReview ?? null) as
        | { issues?: Array<{ severity?: string; description?: string }>; iteration?: { round?: number } }
        | null;
      const normalizedPlan = normalizeBuildPlanPaths(build.buildPlan as Parameters<typeof normalizeBuildPlanPaths>[0]);
      if (normalizedPlan.rewrites.length > 0 || normalizedPlan.unresolvedModifyPaths.length > 0) {
        await prisma.featureBuild.update({
          where: { buildId },
          data: {
            buildPlan: normalizedPlan.plan as unknown as import("@dpf/db").Prisma.InputJsonValue,
          },
        });
      }
      if (normalizedPlan.unresolvedModifyPaths.length > 0) {
        const review = {
          decision: "fail" as const,
          issues: normalizedPlan.unresolvedModifyPaths.map((path) => ({
            severity: "critical" as const,
            description: `Plan refers to missing modify target: ${path}`,
          })),
          summary: "Build plan points at files that do not exist in the current repo.",
        };
        await prisma.featureBuild.update({ where: { buildId }, data: { planReview: review as unknown as import("@dpf/db").Prisma.InputJsonValue } });
        if (context?.threadId) {
          const { agentEventBus } = await import("@/lib/agent-event-bus");
          agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "planReview" });
        }
        logBuildActivity(buildId, "reviewBuildPlan", `Plan review: fail. ${review.summary}`);
        await triggerPlanReviewAutoRepair(buildId, userId, context);
        return {
          success: true,
          message: `Plan review FAILED. Blocking issues: ${normalizedPlan.unresolvedModifyPaths.join(", ")} no longer exist in the repo. Revise the implementation plan to target the current files, then re-run reviewBuildPlan.`,
          data: { review, blocked: true, action: "revise_and_resubmit" },
        };
      }
      const { buildPlanReviewPrompt, buildArchitectureReviewPrompt, finalizeArchitectureAdvisory, parseReviewResponse, mergeReviews, applyTestFirstLenienceForKind, relaxTestFirstAfterRounds, collectReviewerVerdicts } = await import("@/lib/build-reviewers");
      // BI-4396EFEC (D38) — Compute the iteration context up front so we can
      // (a) feed prior issues into the reviewer prompt and (b) populate
      // ReviewResult.iteration on the output. Round is 1-based: first
      // review = 1, every subsequent reviewBuildPlan call increments.
      const priorRound = priorPlanReview?.iteration?.round ?? 0;
      const priorIssues = Array.isArray(priorPlanReview?.issues)
        ? priorPlanReview!.issues!
            .filter((i): i is { severity: string; description: string } =>
              typeof i?.severity === "string" && typeof i?.description === "string",
            )
            .map((i) => ({ severity: i.severity, description: i.description }))
        : [];
      const currentRound = priorRound + 1;
      const priorContext = priorIssues.length > 0
        ? { round: priorRound, issues: priorIssues }
        : null;
      const prompt = buildPlanReviewPrompt(normalizedPlan.plan, priorContext);
      const archPrompt = buildArchitectureReviewPrompt({ kind: "plan", plan: normalizedPlan.plan }, "");
      const { routeAndCall } = await import("@/lib/routed-inference");
      const messages = [{ role: "user" as const, content: prompt }];
      // Two checklist reviewers PLUS the advisory architecture reviewer
      // (chief-architect / Enterprise Architect lens), all in parallel. The
      // architecture reviewer is advisory only — it never enters mergeReviews,
      // it rides along on review.architectureAdvisory and the deliberation
      // `architect` branch so the coworker can fold concerns into the plan.
      const [r1settled, r2settled, archSettled] = await Promise.allSettled([
        routeAndCall(messages, "You are a plan reviewer.", "internal"),
        routeAndCall(
          messages,
          "You are an independent plan reviewer. Focus especially on missing tasks, dependency ordering, absent test-first steps, and data seeding gaps.",
          "internal",
          { budgetClass: "minimize_cost" },
        ),
        routeAndCall(
          [{ role: "user" as const, content: archPrompt }],
          `You are the ${ENTERPRISE_ARCHITECT_DISPLAY_NAME} (DPF chief-architect lens) reviewing for architectural alignment. Advisory only — surface concerns and concrete plan edits, never block the gate.`,
          "internal",
          { budgetClass: "minimize_cost" },
        ),
      ]);
      const r1 = r1settled.status === "fulfilled" ? parseReviewResponse(r1settled.value.content) : null;
      const r2 = r2settled.status === "fulfilled" ? parseReviewResponse(r2settled.value.content) : null;
      const archReview = archSettled.status === "fulfilled" ? parseReviewResponse(archSettled.value.content) : null;
      const architectureAdvisory = await finalizeArchitectureAdvisory(prisma, archReview, userId, context?.agentId, context?.threadId, "reviewPlanDoc");
      const archAdvisoryNote = architectureAdvisory && architectureAdvisory.issues.length > 0
        ? ` Architecture review (advisory): ${architectureAdvisory.summary} Fold actionable items into the plan before building — they do not block this gate.`
        : "";
      const rawMergedReview = r1 && r2 ? mergeReviews(r1, r2) : r1 ?? r2 ?? {
        decision: "fail" as const,
        issues: [{ severity: "critical" as const, description: "Both review agents failed to respond" }],
        summary: "Review could not be completed — retry.",
        // BI-D33F968A: nobody read the work. `fail` is the safe default, not a
        // verdict — mark it so a repair loop does not spend rounds "fixing"
        // something no reviewer looked at.
        reviewIncomplete: true,
      };
      // Deterministic kind-aware lenience: a chore/fix/docs build must not be
      // blocked by a reviewer's missing-test-first complaint (test-first is a
      // feature-grade gate). Enforced in code so it does not depend on the
      // reviewer model honoring the rubric's prose exemption — the local model
      // in particular over-applies TDD to comment/chore tasks.
      let mergedReview = applyTestFirstLenienceForKind(rawMergedReview, build.kind);
      // Round-aware test-first relaxation. The kind-lenience above excludes
      // feature builds by design, but a weak reviewer (notably the on-host local
      // model) over-applies test-first to feature plans and invents
      // non-requirements ("add a test that a function is exported"), wedging the
      // gate so a feature can never converge and escalates forever. Once a plan
      // has cycled through its genuine fix rounds (currentRound >= the relax
      // floor; default 3 = the initial review + 2 PLAN_FIX_MAX_ROUNDS fix rounds)
      // and the ONLY remaining blockers are test-first complaints, downgrade them
      // so the build proceeds — the test-first requirement is still enforced
      // downstream at the build/build-review gates (which review the actual code).
      // Real blockers never match the matchers, so a genuinely-broken plan still
      // fails and escalates. Early rounds (1..2) are completely unaffected.
      const testFirstRelaxFloor = Number(process.env.FEATURE_TESTFIRST_RELAX_ROUND) || 3;
      if (mergedReview.decision === "fail" && currentRound >= testFirstRelaxFloor) {
        const relaxed = relaxTestFirstAfterRounds(mergedReview, currentRound);
        if (relaxed.decision === "pass") {
          mergedReview = relaxed;
          logBuildActivity(buildId, "reviewBuildPlan", `Round ${currentRound}: remaining plan-review blockers were test-first-only — downgraded so the build proceeds; downstream gates still enforce tests.`);
        }
      }
      // BI-269922A4 — Verified-finding review (opt-in). Before a CRITICAL plan
      // finding is allowed to block the gate and trigger another rework round,
      // an independent fresh-context verifier must reproduce it; criticals it
      // cannot reproduce downgrade to advisory. Fail-closed: a verifier error
      // leaves the finding blocking. Inert unless DPF_BUILD_VERIFIED_FINDING_REVIEW=1.
      if (mergedReview.decision === "fail") {
        const { isVerifiedFindingReviewEnabled } = await import("@/lib/build/build-studio-config");
        if (isVerifiedFindingReviewEnabled()) {
          const { verifyReviewFindings } = await import("@/lib/build/verified-finding-review");
          const planArtifact = JSON.stringify(build.buildPlan ?? {}, null, 2);
          const verified = await verifyReviewFindings(mergedReview, planArtifact, {
            dispatch: async (verifierPrompt) => {
              const out = await routeAndCall(
                [{ role: "user" as const, content: verifierPrompt }],
                "You are an independent verifier. Reproduce or refute the finding against the artifact; default to not-verified when uncertain.",
                "internal",
                { budgetClass: "minimize_cost" },
              );
              return out.content;
            },
          });
          const downgraded = mergedReview.issues.length - verified.review.issues.filter((i) => i.severity === "critical").length;
          if (verified.review.decision !== mergedReview.decision || downgraded > 0) {
            logBuildActivity(buildId, "reviewBuildPlan", `Verified-finding review: ${verified.verdicts.filter((v) => !v.verified).length} of ${verified.verdicts.length} critical finding(s) could not be independently reproduced — downgraded to advisory. Gate now: ${verified.review.decision}.`);
          }
          mergedReview = verified.review;
        }
      }
      // BI-4396EFEC (D38) — Compute the iteration delta against the prior
      // round and attach to the ReviewResult. computeReviewDelta + isOscillating
      // live in feature-build-types so they're independently unit-testable.
      const { computeReviewDelta, isOscillating } = await import("@/lib/feature-build-types");
      const reviewWithIteration = (() => {
        const base = mergedReview;
        if (priorIssues.length === 0) {
          return { ...base, iteration: { round: currentRound } };
        }
        const delta = computeReviewDelta(priorIssues, base.issues);
        return {
          ...base,
          iteration: {
            round: currentRound,
            prior: delta,
            oscillating: isOscillating(delta, base.issues.length),
          },
        };
      })();
      const review = architectureAdvisory
        ? { ...reviewWithIteration, architectureAdvisory }
        : reviewWithIteration;
      // Preserve individual reviewer verdicts (pre-merge) for the Review-phase UI.
      const reviewers = collectReviewerVerdicts(r1, r2, archReview);
      const planReviewToPersist = reviewers.length > 0 ? { ...review, reviewers } : review;
      await prisma.featureBuild.update({ where: { buildId }, data: { planReview: planReviewToPersist as unknown as import("@dpf/db").Prisma.InputJsonValue } });
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "planReview" });
      logBuildActivity(buildId, "reviewBuildPlan", `Plan review: ${review.decision}. ${review.summary}`);

      // Record a deliberation trail for this dual-reviewer run. See the
      // matching block in reviewDesignDoc — same rules: review gate above is
      // authoritative, deliberation persistence is best-effort, failures are
      // logged loudly but do not throw.
      try {
        const reviewerBranches: ReviewBranchInput[] = [];
        if (r1) reviewerBranches.push({ branchNodeId: "reviewer-1", role: "reviewer", review: r1 });
        if (r2) reviewerBranches.push({ branchNodeId: "reviewer-2", role: "reviewer", review: r2 });
        // Advisory architecture branch — surfaces architectural risk into the
        // deliberation summary without flipping the gate.
        if (archReview) reviewerBranches.push({ branchNodeId: "architect", role: "architect", review: archReview });
        if (reviewerBranches.length > 0) {
          const { runBuildReviewDeliberation } = await import("@/lib/build/build-orchestrator");
          await runBuildReviewDeliberation({
            userId,
            buildId,
            phase: "plan",
            reviewerBranches,
            ...(context?.threadId ? { threadId: context.threadId } : {}),
          });
        }
      } catch (err) {
        console.warn("[deliberation] failed to record build review trail: %s",
          err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)));
      }

      // Failed review → revise UNLESS the policy gate makes a passing plan
      // review optional for this kind/size. For doc + chore-small builds the
      // gate (build-process-matrix) is `buildPlan-present` only — it does NOT
      // require `planReview-passed` — so a failed plan review must be ADVISORY,
      // not a hard loop. checkPhaseGate is the source of truth (the same
      // gate-driven principle #2085 applied to verification). Without this a
      // strict reviewer rejecting a trivial-but-correct plan (e.g. "verify the
      // function exists at line N", which it does) loops the build forever at
      // plan-review and burns review quota. Only return revise-and-resubmit when
      // the gate truly requires the review to pass.
      if (review.decision === "fail") {
        let planReviewIsGating = true;
        try {
          const { checkPhaseGate: cgFail, normalizeHappyPathState: nhpsFail } = await import("@/lib/feature-build-types");
          const fgBuild = await prisma.featureBuild.findUnique({
            where: { buildId },
            select: { phase: true, plan: true, buildPlan: true, kind: true },
          });
          if (fgBuild?.phase === "plan") {
            const fgPlan = (fgBuild.plan as Record<string, unknown> | null) ?? {};
            const fgGate = cgFail("plan", "build", {
              kind: fgBuild.kind,
              processSize: (fgPlan.processSize as string | undefined) ?? "medium",
              deliverableSensitivity: fgPlan.deliverableSensitivity,
              qualityFirst: fgPlan.qualityFirst === true,
              buildPlan: fgBuild.buildPlan,
              planReview: review, // the FAILED review — the gate decides if it matters
              happyPathState: nhpsFail(fgPlan.happyPathState),
            });
            planReviewIsGating = !fgGate.allowed;
          }
        } catch {
          planReviewIsGating = true; // fail safe: keep the stricter loop on any gate-read error
        }
        if (planReviewIsGating) {
          await triggerPlanReviewAutoRepair(buildId, userId, context);
          const criticalIssues = review.issues.filter((i: { severity: string }) => i.severity === "critical");
          const issueList = criticalIssues.length > 0
            ? criticalIssues.map((i: { description: string }) => i.description).join("; ")
            : review.summary;
          // BI-4396EFEC (D38) — iteration trajectory so the implementer model
          // sees when revisions trade one issue set for another vs converging.
          const iter = review.iteration;
          const trajectoryNote = iter?.prior
            ? ` (Round ${iter.round}: ${iter.prior.addressed} addressed, ${iter.prior.persisted} persist, ${iter.prior.newlySurfaced} new${iter.oscillating ? " — issues are not net-decreasing across rounds; consider proposing a scope split rather than another revision." : ""}.)`
            : "";
          return {
            success: true,
            message: `Plan review FAILED. Blocking issues: ${issueList}. Revise the implementation plan to address these issues, then call saveBuildEvidence with field "buildPlan" and re-run reviewBuildPlan.${trajectoryNote}${archAdvisoryNote}`,
            data: { review, blocked: true, action: "revise_and_resubmit" },
          };
        }
        // Gate does not require a passing plan review for this kind/size — record
        // the failure as advisory and fall through to the gate-driven advance.
        logBuildActivity(buildId, "reviewBuildPlan", `Plan review failed but is ADVISORY for this kind/size (phase gate does not require planReview-passed) — advancing on the gate; issues recorded for visibility.`);
      }

      // Passed review (or advisory-non-gating) → advance to build via the SINGLE
      // transition executor, shared with the auto-resume reconciler so the plan→
      // build side-effect lives in exactly one place (BI-05208DE5). The executor
      // runs the structural + dependency + WWMD kernel gates (fail-open on kernel
      // error, block on a genuine principle conflict), initializes the build
      // branch BEFORE flipping the phase (so `buildBranch` is paired with
      // `phase=build`), auto-dispatches the build orchestrator, and — critically —
      // COUNTS a branch-init/sandbox failure and escalates past a threshold
      // instead of silently looping forever (the flood that wedged self-upgrade).
      try {
        const { performPlanToBuildTransition } = await import("@/lib/build/plan-to-build-transition");
        const outcome = await performPlanToBuildTransition({ buildId, userId, context });
        if (outcome.kind === "escalated") {
          logBuildActivity(buildId, "reviewBuildPlan", `plan → build escalated to operator after ${outcome.failures} failed transition attempts (${outcome.reason}).`);
        }
      } catch (err) {
        console.error("[reviewBuildPlan] auto-advance failed:", err);
      }

      return { success: true, message: `Plan review: ${review.decision}. ${review.summary}${archAdvisoryNote}`, data: { review } };
  } catch (err) {
    return toFailureResult("reviewBuildPlan", err);
  }
}
