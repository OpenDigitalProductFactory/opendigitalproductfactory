// Build-evidence-extra tool pack — EP-8DC217EB BET-4.
//
// Drains the remaining Build Studio evidence/handoff writers out of the
// mcp-tools.ts executeTool switch: persist conversational spec notes onto the
// running build, save a structured phase-handoff briefing (with gated
// auto-advance), and record external (Claude/Codex/Grok) development handoff
// evidence with auto-capsule capture. Each handler is the former switch case
// verbatim, so behaviour is identical when a tool is invoked over MCP. Build id
// is auto-resolved through the shared build helpers.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import { prisma } from "@dpf/db";

import { recordExternalEvidence } from "@/lib/actions/external-evidence";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import { extractBuildIdHint, logBuildActivity, resolveActiveBuildId } from "@/lib/mcp/build-tool-helpers";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

/**
 * Local copy of mcp-tools.ts `resolveSavePhaseHandoffTransition` (left inline
 * there). Replicated rather than imported because mcp-tools.ts imports the pack
 * registry, so importing this runtime function back would form an import cycle.
 * Reads only `agentId`/`routeContext`, both carried on the pack handler context.
 */
function resolveSavePhaseHandoffTransition(
  params: Record<string, unknown>,
  context: { agentId?: string; routeContext?: string } | undefined,
  currentPhase: string,
): { toPhase: string; autoAdvance: boolean; isInternalTaskHandoff: boolean } {
  const phaseOrder = ["ideate", "plan", "build", "review", "ship"];
  const idx = phaseOrder.indexOf(currentPhase);
  const isInternalTaskHandoff =
    context?.agentId === "AGT-ORCH-300"
    && context?.routeContext === "/build"
    && params["autoAdvance"] === false;
  const requestedToPhase = isInternalTaskHandoff
    && typeof params["toPhase"] === "string"
    && [...phaseOrder, "complete"].includes(String(params["toPhase"]).trim())
    ? String(params["toPhase"]).trim()
    : null;

  return {
    toPhase: requestedToPhase ?? (idx >= 0 && idx < phaseOrder.length - 1 ? phaseOrder[idx + 1]! : "complete"),
    autoAdvance: isInternalTaskHandoff ? false : true,
    isInternalTaskHandoff,
  };
}

const definitions: ToolDefinition[] = [
  {
    name: "save_build_notes",
    description: "Persist key points from the conversation to the running spec. Call silently after each significant exchange.",
    inputSchema: {
      type: "object",
      properties: {
        processes: { type: "array", items: { type: "string" }, description: "Manual or automated processes described" },
        requirements: { type: "array", items: { type: "string" }, description: "Requirements discovered (fields, workflows, roles)" },
        decisions: { type: "array", items: { type: "string" }, description: "Decisions made (build vs buy, priorities)" },
        integrations: { type: "array", items: { type: "string" }, description: "External systems or APIs mentioned" },
        dataModel: { type: "array", items: { type: "string" }, description: "Data fields, entities, or structures identified" },
        openQuestions: { type: "array", items: { type: "string" }, description: "Questions still to resolve" },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan"],
  },
  {
    name: "save_phase_handoff",
    description: "Save a structured handoff briefing for the next phase. Call this as your LAST action before a phase transition.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
        summary: { type: "string", description: "2-3 sentence plain-language summary of what was accomplished in this phase" },
        decisionsMade: { type: "array", items: { type: "string" }, description: "Key decisions made and why" },
        openIssues: { type: "array", items: { type: "string" }, description: "Unresolved issues or risks carried to next phase" },
        userPreferences: { type: "array", items: { type: "string" }, description: "User preferences or constraints expressed during this phase" },
      },
      required: ["summary"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review"],
  },
  {
    name: "record_external_development_evidence",
    description: "Record Claude, Codex, Grok or other external development handoff evidence with optional Build Studio build/task links. Use for branches, commits, changed files, verification results, local integration output, unresolved questions, and skills used.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "External development provider, for example claude, codex, or grok" },
        externalSessionId: { type: "string", description: "External thread/session/capsule identifier" },
        backlogItemId: { type: "string", description: "Optional BI-* to bind the captured Work Capsule to, even without a build (closes the direct-agent binding gap)" },
        worktreePath: { type: "string", description: "Optional local worktree path — when given with branchName the capsule also records the work location" },
        branchName: { type: "string", description: "Optional branch (head) for this work — pairs with worktreePath to bind location" },
        repositoryFullName: { type: "string", description: "Canonical repository owner/name for provider verification" },
        buildId: { type: "string", description: "Optional FB-* build id" },
        taskRunId: { type: "string", description: "Optional TaskRun id" },
        routeContext: { type: "string", description: "Route context where the work belongs, usually /build" },
        summary: { type: "string", description: "Operator-readable handoff summary" },
        commits: { type: "array", items: { type: "string" }, description: "Commit SHAs or refs included in the handoff" },
        changedFiles: { type: "array", items: { type: "string" }, description: "Files touched by the external work" },
        verification: { type: "array", items: { type: "string" }, description: "Verification commands and outcomes" },
        localIntegration: { type: "object", description: "Local merged-code integration result summary" },
        unresolvedQuestions: { type: "array", items: { type: "string" }, description: "Open questions that still need decision or founder review" },
        skillIds: { type: "array", items: { type: "string" }, description: "DPF skill ids used by the external contributor" },
      },
      required: ["provider", "externalSessionId", "summary", "routeContext"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
  },
];

const saveBuildNotes: ToolPackHandler = async (params, userId) => {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
  const latestBuild = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { buildId: true, plan: true },
  });
  if (!latestBuild) return { success: false, error: "No active build", message: "No active build found" };

  const existing = (latestBuild.plan as Record<string, unknown> | null) ?? {};
  const mergeArray = (key: string) => {
    const prev = Array.isArray(existing[key]) ? existing[key] as string[] : [];
    const incoming = Array.isArray(params[key]) ? (params[key] as string[]).map(String) : [];
    // Deduplicate
    return [...new Set([...prev, ...incoming])];
  };

  const merged = {
    ...existing,
    processes: mergeArray("processes"),
    requirements: mergeArray("requirements"),
    decisions: mergeArray("decisions"),
    integrations: mergeArray("integrations"),
    dataModel: mergeArray("dataModel"),
    openQuestions: mergeArray("openQuestions"),
    lastUpdated: new Date().toISOString(),
  };

  await prisma.featureBuild.update({
    where: { buildId: latestBuild.buildId },
    data: { plan: merged as import("@dpf/db").Prisma.InputJsonValue },
  });

  const totalItems = merged.processes.length + merged.requirements.length + merged.decisions.length + merged.integrations.length + merged.dataModel.length;
  return { success: true, message: `Spec updated — ${totalItems} items captured.` };
};

const savePhaseHandoff: ToolPackHandler = async (params, userId, context) => {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
  const latestBuild = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { buildId: true, phase: true, kind: true, threadId: true, designDoc: true, designReview: true, buildPlan: true, planReview: true, verificationOut: true, acceptanceMet: true, uxTestResults: true, uxVerificationStatus: true, brief: true, plan: true },
  });
  if (!latestBuild) return { success: false, error: "No active build", message: "No active build found" };

  // Determine the next phase. Hidden task-handoff controls are accepted
  // only from the build orchestrator context; public callers keep the
  // normal phase-transition behavior even if they send schema-extra params.
  const { toPhase, autoAdvance } = resolveSavePhaseHandoffTransition(params, context, latestBuild.phase);

  // Write the handoff record with a structured evidence manifest derived
  // from the build's own evidence columns, so the next phase reads a
  // one-line-per-field digest (rendered by agent-coworker's "Context from
  // Previous Phase" block) instead of relying on the free-text summary
  // alone. gateResult is filled on auto-advance below, once the gate runs.
  const { buildPhaseHandoffEvidence } = await import("@/lib/feature-build-types");
  const handoffEvidence = buildPhaseHandoffEvidence(latestBuild);
  const createdHandoff = await prisma.phaseHandoff.create({
    data: {
      buildId: latestBuild.buildId,
      fromPhase: latestBuild.phase,
      toPhase,
      fromAgentId: context?.agentId ?? "unknown",
      toAgentId: "pending",
      summary: String(params["summary"] ?? ""),
      decisionsMade: Array.isArray(params["decisionsMade"]) ? (params["decisionsMade"] as string[]).map(String) : [],
      openIssues: Array.isArray(params["openIssues"]) ? (params["openIssues"] as string[]).map(String) : [],
      userPreferences: Array.isArray(params["userPreferences"]) ? (params["userPreferences"] as string[]).map(String) : [],
      evidenceFields: handoffEvidence.evidenceFields,
      evidenceDigest: handoffEvidence.evidenceDigest,
      gateResult: {},
    },
  });

  // Compress older handoffs for this build (fire-and-forget)
  // Keep most recent handoff in full; summarize older ones to save context budget.
  prisma.phaseHandoff.findMany({
    where: { buildId: latestBuild.buildId, compressedSummary: null },
    orderBy: { createdAt: "asc" },
  }).then(async (allHandoffs) => {
    // Only compress if there are 2+ handoffs (skip the newest one)
    if (allHandoffs.length < 2) return;
    const toCompress = allHandoffs.slice(0, -1); // all except newest
    const { utilityInfer } = await import("@/lib/inference/utility-inference");
    for (const h of toCompress) {
      const fullText = [
        `[${h.fromPhase} → ${h.toPhase}] ${h.summary}`,
        h.decisionsMade.length > 0 ? `Decisions: ${h.decisionsMade.join("; ")}` : "",
        h.openIssues.length > 0 ? `Open issues: ${h.openIssues.join("; ")}` : "",
        h.userPreferences.length > 0 ? `User preferences: ${h.userPreferences.join("; ")}` : "",
      ].filter(Boolean).join("\n");
      try {
        const result = await utilityInfer({ task: "summarize", input: fullText });
        if (result?.output) {
          await prisma.phaseHandoff.update({
            where: { id: h.id },
            data: { compressedSummary: `[${h.fromPhase} → ${h.toPhase}] ${result.output}` },
          });
        }
      } catch { /* non-fatal */ }
    }
  }).catch(() => {});

  if (!autoAdvance) {
    return { success: true, message: `Phase handoff saved: ${latestBuild.phase} → ${toPhase}` };
  }

  // Actually advance the phase — the agent calls this as its last action
  // before transitioning, so this is the right place to do the DB update.
  // Gate check ensures we don't skip required evidence, and crucially
  // passes happyPathState (intake anchors) so the gate's intake check
  // evaluates against the real build state rather than default-null.
  try {
    const { canTransitionPhase, normalizeHappyPathState } = await import("@/lib/feature-build-types");
    const { checkBuildPhaseGate } = await import("@/lib/work-posture/verification-depth-gate");
    if (canTransitionPhase(latestBuild.phase as import("@/lib/feature-build-types").BuildPhase, toPhase as import("@/lib/feature-build-types").BuildPhase)) {
      const plan = (latestBuild.plan as Record<string, unknown> | null) ?? {};
      const happyPathState = normalizeHappyPathState(plan.happyPathState);
      const handoffBrief = latestBuild.brief as { acceptanceCriteria?: string[]; fixContext?: import("@/lib/feature-build-types").FixContext } | null;
      const gate = await checkBuildPhaseGate({
        buildId,
        from: latestBuild.phase as import("@/lib/feature-build-types").BuildPhase,
        to: toPhase as import("@/lib/feature-build-types").BuildPhase,
        evidence: {
          kind: latestBuild.kind,
          // Right-sizing matrix: persisted on plan.processSize at promote time.
          processSize: (plan.processSize as string | undefined) ?? "medium",
          fixContext: handoffBrief?.fixContext,
          designDoc: latestBuild.designDoc, designReview: latestBuild.designReview,
          buildPlan: latestBuild.buildPlan, planReview: latestBuild.planReview,
          verificationOut: latestBuild.verificationOut, acceptanceMet: latestBuild.acceptanceMet,
          uxTestResults: latestBuild.uxTestResults,
          uxVerificationStatus: latestBuild.uxVerificationStatus,
          acceptanceCriteria: handoffBrief?.acceptanceCriteria ?? [],
          happyPathState,
        },
      });
      // Record the gate outcome on the handoff (the gate that allowed —
      // or blocked — advancement). Best-effort; never fail the handoff.
      await prisma.phaseHandoff
        .update({
          where: { id: createdHandoff.id },
          data: {
            gateResult: {
              allowed: gate.allowed,
              reason: gate.reason ?? null,
              fromPhase: latestBuild.phase,
              toPhase,
            } as unknown as import("@dpf/db").Prisma.InputJsonValue,
          },
        })
        .catch(() => {});
      if (gate.allowed) {
        if (toPhase === "complete") {
          const { completeFeatureBuildTransition } = await import(
            "@/lib/backlog/initiative-readiness/build-terminal-transition"
          );
          const terminal = await completeFeatureBuildTransition({
            buildId: latestBuild.buildId,
            expectedPhase: latestBuild.phase,
          });
          if (!terminal.ok) {
            return {
              success: false,
              error: "initiative_not_ready",
              message: `Build completion is blocked by ${terminal.code}.`,
              data: { code: terminal.code, readiness: terminal.decision },
            };
          }
        } else {
          await prisma.featureBuild.update({ where: { buildId: latestBuild.buildId }, data: { phase: toPhase } });
        }
        if (toPhase === "review") {
          const { queueBuildReviewVerification } = await import("@/lib/build-review-verification-trigger");
          await queueBuildReviewVerification(latestBuild.buildId);
        }
        const { agentEventBus } = await import("@/lib/agent-event-bus");
        if (latestBuild.threadId) agentEventBus.emit(latestBuild.threadId, { type: "phase:change", buildId: latestBuild.buildId, phase: toPhase } as import("@/lib/agent-event-bus").AgentEvent);
        logBuildActivity(latestBuild.buildId, "phase:advance", `Phase advanced: ${latestBuild.phase} → ${toPhase}`);
        return { success: true, message: `Phase advanced: ${latestBuild.phase} → ${toPhase}` };
      }
      return { success: true, message: `Phase handoff saved but gate blocked advance: ${gate.reason}. Evidence may be incomplete.` };
    }
  } catch (err) {
    console.error("[save_phase_handoff] auto-advance failed:", err);
  }

  return { success: true, message: `Phase handoff saved: ${latestBuild.phase} → ${toPhase}` };
};

const recordExternalDevelopmentEvidence: ToolPackHandler = async (params, userId, context) => {
  const stringValue = (key: string) => (typeof params[key] === "string" ? String(params[key]).trim() : "");
  const stringArray = (key: string) => (
    Array.isArray(params[key])
      ? (params[key] as unknown[])
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
      : []
  );
  const provider = stringValue("provider");
  const externalSessionId = stringValue("externalSessionId");
  const summary = stringValue("summary");
  const routeContext = stringValue("routeContext") || context?.routeContext || "";
  const missing = [
    ["provider", provider],
    ["externalSessionId", externalSessionId],
    ["summary", summary],
    ["routeContext", routeContext],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    return {
      success: false,
      error: "missing_required",
      message: `Missing required external development evidence field(s): ${missing.join(", ")}`,
    };
  }

  const buildId = stringValue("buildId") || undefined;
  const taskRunId = stringValue("taskRunId") || undefined;

  // Authorize the supplied build before we write. Access model is owner-only
  // today, mirroring resolveActiveBuildId / getFeatureBuildForContext: a caller
  // holding only the view_platform grant must not attach an ExternalEvidenceRecord
  // to a build owned by someone else (EP-UNIFIED-TRACKING Phase 0 / BI-4196AB21).
  // A non-existent buildId is dangling, not a security risk — the read-side joins
  // only real builds — so it is allowed (preserving back-compat for callers that
  // pass an optimistic buildId). taskRunId ownership folds into the capsule-linkage
  // work (BI-6357B975), where the canonical owner resolves.
  if (buildId) {
    const ownedBuild = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { createdById: true },
    });
    if (ownedBuild && ownedBuild.createdById !== userId) {
      return {
        success: false,
        error: "forbidden",
        message: `Not authorized to attach external development evidence to build ${buildId}`,
      };
    }
  }

  const localIntegration =
    params["localIntegration"] && typeof params["localIntegration"] === "object" && !Array.isArray(params["localIntegration"])
      ? params["localIntegration"] as Record<string, unknown>
      : null;
  const details = {
    commits: stringArray("commits"),
    changedFiles: stringArray("changedFiles"),
    verification: stringArray("verification"),
    localIntegration,
    unresolvedQuestions: stringArray("unresolvedQuestions"),
    skillIds: stringArray("skillIds"),
  };
  const publishedCommits = details.commits.filter((commit) => /^[a-f0-9]{40}$/i.test(commit));
  const evidence = await recordExternalEvidence({
    actorUserId: userId,
    routeContext,
    operationType: "external_development_handoff",
    target: externalSessionId,
    provider,
    resultSummary: summary,
    buildId,
    taskRunId,
    details: details as unknown as import("@dpf/db").Prisma.InputJsonValue,
  });

  // Durable auto-capture (EP-UNIFIED-TRACKING / BI-636A11B3): recording evidence
  // (which AGENTS.md §17 asks external agents to do) also makes the session a
  // tracked Workroom, so its work appears in the cross-surface activity view
  // without a manual adopt_worktree. Idempotent per externalSessionId; best-effort
  // — a capture failure must never fail the evidence write.
  let capturedCapsuleId: string | null = null;
  try {
    const { captureExternalSessionEvidence } = await import(
      "@/lib/work-capsules/external-session-capture"
    );
    capturedCapsuleId = await captureExternalSessionEvidence({
      db: prisma,
      externalSessionId,
      provider,
      summary,
      actor: { userId, agentId: context?.agentId ?? null, principalId: null },
      backlogItemId: stringValue("backlogItemId") || null,
      worktreePath: stringValue("worktreePath") || null,
      branchName: stringValue("branchName") || null,
      repositoryFullName: stringValue("repositoryFullName") || null,
      publishedCommitSha: publishedCommits.length === 1 ? publishedCommits[0] : null,
    });
  } catch (captureError) {
    console.warn(
      "[record_external_development_evidence] auto-capsule capture failed:",
      getErrorMessage(captureError),
    );
  }

  // Bind the evidence record to the capsule the capture just resolved so it
  // rolls up onto the capsule timeline with producer identity
  // (EP-WORK-CONVERGENCE Phase 1 / BI-D6FA8641). The record was written
  // before capture (order preserved for back-compat); patch it here.
  // Best-effort — a link failure must never fail the evidence write.
  if (capturedCapsuleId) {
    try {
      await prisma.externalEvidenceRecord.update({
        where: { id: evidence.id },
        data: {
          workCapsuleId: capturedCapsuleId,
          executorKind: provider,
          ...(context?.agentId ? { recordedByAgentId: context.agentId } : {}),
        },
      });
    } catch (linkError) {
      console.warn(
        "[record_external_development_evidence] capsule link failed:",
        getErrorMessage(linkError),
      );
    }
  }

  return {
    success: true,
    entityId: evidence.id,
    message: `Recorded external development evidence from ${provider}.`,
    data: {
      evidenceId: evidence.id,
      buildId: buildId ?? null,
      taskRunId: taskRunId ?? null,
      workCapsuleId: capturedCapsuleId,
    },
  };
};

const handlers: Record<string, ToolPackHandler> = {
  save_build_notes: saveBuildNotes,
  save_phase_handoff: savePhaseHandoff,
  record_external_development_evidence: recordExternalDevelopmentEvidence,
};

export const buildEvidenceExtraPack: ToolPack = {
  packId: "build-evidence-extra",
  definitions,
  handlers,
  grants: {
    save_build_notes: ["build_evidence"],
    save_phase_handoff: ["backlog_write"],
    record_external_development_evidence: ["backlog_write"],
  },
};
