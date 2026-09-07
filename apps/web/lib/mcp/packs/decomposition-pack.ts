// Build-decomposition tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the self-contained build-decomposition domain out of the mcp-tools.ts
// executeTool switch: the five tools the intake and Software-Engineering
// coworkers use to size and split work — score a feature's complexity, generate
// an epic + feature-set breakdown for a complex idea, propose candidate splits
// of an oversized passed-design build, approve a chosen split into an execution
// Epic + child builds, and record an operator's "keep as one build" override.
// Each handler reproduces the former switch case verbatim (including the same
// lazy imports of the build/decomposition service modules), so behaviour is
// identical when a tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "assess_complexity",
    description: "Score a feature on 7 dimensions, get path recommendation (simple/moderate/complex).",
    inputSchema: {
      type: "object",
      properties: {
        taxonomySpan: { type: "number", description: "Score 1-3: 1=single node, 2=multi-node, 3=cross-portfolio" },
        dataEntities: { type: "number", description: "Score 1-3: 1=read-only, 2=CRUD on existing, 3=new schema" },
        integrations: { type: "number", description: "Score 1-3: 1=none, 2=internal, 3=external" },
        novelty: { type: "number", description: "Score 1-3: 1=pattern exists, 2=variation, 3=novel" },
        regulatory: { type: "number", description: "Score 1-3: 1=none, 2=moderate, 3=regulated" },
        costEstimate: { type: "number", description: "Score 1-3: 1=small, 2=medium, 3=large" },
        techDebt: { type: "number", description: "Score 1-3: 1=low, 2=moderate, 3=high" },
      },
      required: ["taxonomySpan", "dataEntities", "integrations", "novelty", "regulatory", "costEstimate", "techDebt"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate"],
  },
  {
    name: "propose_decomposition",
    description: "Generate an epic + feature set breakdown for a complex idea.",
    inputSchema: {
      type: "object",
      properties: {
        epicTitle: { type: "string" },
        epicDescription: { type: "string" },
        featureSets: { type: "array", items: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, type: { type: "string", enum: ["feature_build", "digital_product"] }, estimatedBuilds: { type: "number" }, recommendation: { type: "string", enum: ["build", "buy", "integrate"] }, rationale: { type: "string" }, techDebtNote: { type: "string" } }, required: ["title", "description", "type", "estimatedBuilds", "recommendation", "rationale"] } },
      },
      required: ["epicTitle", "epicDescription", "featureSets"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate"],
  },
  {
    // NOTE: this tool is DISTINCT from the existing `propose_decomposition`
    // (epic + feature-set breakdown for ideation). This one operates on a
    // passed FeatureBuild design and proposes how to SPLIT it into smaller
    // builds — a downstream-of-Ideate decomposition, not an upstream-from-
    // backlog one. Different name avoids the collision.
    name: "propose_build_decomposition",
    description: "Ask the SE coworker to propose 2-4 candidate decompositions of a passed-design xlarge FeatureBuild. Distinct from `propose_decomposition` (which is an upstream brainstorming tool that generates an Epic + feature-set breakdown). This one is downstream of Ideate — eligible when the build is in `ideate`, has a passed designReview, and the recorded sizeAssessment.decision is `decompose-recommended` or `decompose-required`; also allows a top-level `plan` build whose failed planReview has iteration.oscillating=true, recomputing sizeDesignDoc retroactively when sizeAssessment is missing. Optional `operatorHint` re-runs with guidance ('make the read-first smaller', 'ship the ledger separately'). Persists validated candidates to designReview.decompositionCandidates.latest; prior rounds are preserved under .priorRounds for audit. Returns the validated candidates plus an observability list of rejected ones (model returned them but they failed validateCandidate).",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Originating FeatureBuild ID (FB-*)." },
        operatorHint: {
          type: "string",
          description: "Optional regenerate guidance. Empty/omitted on first generation.",
        },
      },
      required: ["buildId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "approve_decomposition",
    description: "Atomically create an execution-organizational Epic, one live child BacklogItem and FeatureBuild per scope, sibling-dependency edges, and a backlog-coverage receipt from a pre-validated DecompositionCandidate; then mark the originating FeatureBuild as superseded. The originating build must be in `ideate` phase with a passed designReview, or in `plan` with a failed oscillating planReview as the retroactive escape hatch, and must not itself be a child.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Originating FeatureBuild ID (FB-*)." },
        candidate: {
          type: "object",
          description: "The DecompositionCandidate to materialize. See the decomposition-candidates module for the full shape.",
          properties: {
            candidateId: { type: "string" },
            rationale: { type: "string" },
            childScopes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  childOrder: { type: "number" },
                  title: { type: "string" },
                  summary: { type: "string" },
                  acceptanceCriteriaIndices: { type: "array", items: { type: "number" } },
                  dependsOn: { type: "array", items: { type: "number" } },
                },
                required: ["childOrder", "title", "acceptanceCriteriaIndices", "dependsOn"],
              },
            },
          },
          required: ["candidateId", "rationale", "childScopes"],
        },
      },
      required: ["buildId", "candidate"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "record_decomposition_override",
    description: "Record the operator's 'keep as one build' override on a FeatureBuild whose size assessment is decompose-required. Writes the design-review override and an atomic backlog-coverage receipt with the operator rationale. Only valid on decompose-required builds; recommended-tier builds proceed without an override.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "FeatureBuild ID (FB-*)." },
        rationale: { type: "string", description: "Non-empty one-line justification for proceeding monolithically." },
      },
      required: ["buildId", "rationale"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "record_plan_backlog_coverage",
    description: "Write plan-coverage v2 after validating that every independently shippable deliverable maps to a live BacklogItem, has four-way traceability, and is bound to one provider-verified immutable plan blob whose digest the server derives. For profile=fix, the immutable ordered fix design under docs/superpowers/specs may serve as the atomic coverage artifact. The server derives the authoritative profile and validates the path; missing mappings, stale artifacts, incomplete traceability, dependency cycles, and invalid atomic claims fail without writing a receipt.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "Umbrella BacklogItem ID (BI-*)." },
        planPath: { type: "string", description: "Repository-relative implementation plan path, or the canonical ordered fix design path when the server-authoritative profile is fix." },
        planArtifactRef: {
          type: "object",
          description: "Immutable repository plan locator. The server resolves and stores its digest.",
          properties: {
            kind: { type: "string", enum: ["repo-blob-at-commit"] },
            repositoryFullName: { type: "string" },
            commitSha: { type: "string" },
            path: { type: "string" },
            providerBlobId: { type: "string" },
          },
          required: ["kind", "repositoryFullName", "commitSha", "path", "providerBlobId"],
        },
        decision: { type: "string", enum: ["decomposed", "atomic"], description: "Whether independent work is mapped to BIs or the plan is deliberately atomic." },
        rationale: { type: "string", description: "Required for atomic: why no phase is independently shippable." },
        deliverables: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              title: { type: "string" },
              independentlyShippable: { type: "boolean" },
              backlogItemId: { type: "string", description: "Existing or newly filed BI for an independent deliverable." },
              dependsOn: { type: "array", items: { type: "string" } },
              requirementRefs: { type: "array", items: { type: "string" } },
              contractRefs: { type: "array", items: { type: "string" } },
              flowRefs: { type: "array", items: { type: "string" } },
              verificationRefs: { type: "array", items: { type: "string" } },
            },
            required: ["key", "title", "independentlyShippable", "dependsOn", "requirementRefs", "contractRefs", "flowRefs", "verificationRefs"],
          },
        },
      },
      required: ["itemId", "planPath", "planArtifactRef", "decision", "deliverables"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "check_plan_backlog_coverage",
    description: "Revalidate a plan backlog-coverage receipt against the current umbrella item, plan path, deliverable graph, and live mapped BacklogItems. Use before implementation and when resuming a task. Returns an invalid result when the receipt is missing, mismatched, stale, or its mapped items no longer resolve.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "Umbrella BacklogItem ID (BI-*)." },
        planPath: { type: "string", description: "Repository-relative implementation plan path, or the canonical ordered fix design path used by an existing fix-profile receipt." },
        receiptId: { type: "string", description: "BacklogItemActivity receipt returned when coverage was recorded." },
      },
      required: ["itemId", "planPath", "receiptId"],
    },
    requiredCapability: "view_platform",
    sideEffect: false,
  },
  {
    name: "check_branch_plan_backlog_gate",
    description: "Check whether the BacklogItem claimed by a branch is xlarge and, if so, whether it has a current decomposition or atomic coverage decision. Use before source implementation even when no plan file has been written yet.",
    inputSchema: {
      type: "object",
      properties: {
        branchName: { type: "string", description: "Current topic branch bound to a Work Capsule." },
      },
      required: ["branchName"],
    },
    requiredCapability: "view_platform",
    sideEffect: false,
  },
];

async function assessComplexityTool(params: Record<string, unknown>): Promise<ToolResult> {
  const { assessComplexity } = await import("@/lib/complexity-assessment");
  const scores = {
    taxonomySpan: Number(params["taxonomySpan"] ?? 1) as 1 | 2 | 3,
    dataEntities: Number(params["dataEntities"] ?? 1) as 1 | 2 | 3,
    integrations: Number(params["integrations"] ?? 1) as 1 | 2 | 3,
    novelty: Number(params["novelty"] ?? 1) as 1 | 2 | 3,
    regulatory: Number(params["regulatory"] ?? 1) as 1 | 2 | 3,
    costEstimate: Number(params["costEstimate"] ?? 1) as 1 | 2 | 3,
    techDebt: Number(params["techDebt"] ?? 1) as 1 | 2 | 3,
  };
  const result = assessComplexity(scores);
  return { success: true, message: `Complexity: ${result.total}/21 — ${result.path} path.`, data: result as unknown as Record<string, unknown> };
}

async function proposeDecompositionTool(params: Record<string, unknown>): Promise<ToolResult> {
  const { validateDecompositionPlan } = await import("@/lib/decomposition");
  const plan = {
    epicTitle: String(params["epicTitle"] ?? ""),
    epicDescription: String(params["epicDescription"] ?? ""),
    featureSets: Array.isArray(params["featureSets"]) ? params["featureSets"] as import("@/lib/feature-build-types").FeatureSetEntry[] : [],
  };
  const validation = validateDecompositionPlan(plan);
  if (!validation.valid) return { success: false, error: validation.errors.join(", "), message: `Invalid: ${validation.errors.join(", ")}` };
  return { success: true, message: `${plan.epicTitle} — ${plan.featureSets.length} feature set${plan.featureSets.length !== 1 ? "s" : ""}.`, data: plan as unknown as Record<string, unknown> };
}

async function proposeBuildDecomposition(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const buildId = String(params["buildId"] ?? "");
  if (!buildId.startsWith("FB-")) {
    return { success: false, error: "invalid_buildId", message: "buildId must use the FB-* format." };
  }
  const operatorHint = typeof params["operatorHint"] === "string" ? params["operatorHint"] : undefined;
  const { proposeDecomposition } = await import("@/lib/build/propose-decomposition");
  const result = await proposeDecomposition({
    buildId,
    userId,
    agentId: context?.agentId ?? null,
    ...(operatorHint ? { operatorHint } : {}),
  });
  if (!result.ok) {
    return { success: false, error: result.code, message: result.error };
  }
  return {
    success: true,
    entityId: buildId,
    message: `Proposed ${result.candidates.length} candidate decomposition(s) for ${buildId}.${result.rejected.length > 0 ? ` (${result.rejected.length} additional candidate(s) failed validation and were dropped.)` : ""}`,
    data: {
      candidates: result.candidates,
      rejectedCount: result.rejected.length,
    },
  };
}

async function approveDecompositionTool(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const buildId = String(params["buildId"] ?? "");
  const candidateRaw = params["candidate"];
  if (!buildId.startsWith("FB-")) {
    return { success: false, error: "invalid_buildId", message: "buildId must use the FB-* format." };
  }
  if (!candidateRaw || typeof candidateRaw !== "object") {
    return { success: false, error: "invalid_candidate", message: "candidate must be an object matching the DecompositionCandidate shape." };
  }
  const { approveDecomposition } = await import("@/lib/build/approve-decomposition");
  const result = await approveDecomposition({
    buildId,
    candidate: candidateRaw as Parameters<typeof approveDecomposition>[0]["candidate"],
    userId,
    agentId: context?.agentId ?? null,
  });
  if (!result.ok) {
    return { success: false, error: result.code, message: result.error };
  }
  return {
    success: true,
    entityId: result.epicId,
    message: `Decomposed ${buildId} into Epic ${result.epicId} with ${result.childBuildIds.length} child build(s).`,
    data: {
      epicId: result.epicId,
      childBuildIds: result.childBuildIds,
      childBacklogItemIds: result.childBacklogItemIds,
    },
  };
}

async function checkPlanBacklogCoverageTool(params: Record<string, unknown>): Promise<ToolResult> {
  const itemId = String(params["itemId"] ?? "");
  const planPath = String(params["planPath"] ?? "");
  const receiptId = String(params["receiptId"] ?? "");
  if (!itemId.startsWith("BI-")) {
    return { success: false, error: "invalid_itemId", message: "itemId must use the BI-* format." };
  }
  if (!planPath) return { success: false, error: "invalid_plan_path", message: "planPath is required." };
  if (!receiptId) {
    return { success: false, error: "invalid_receipt", message: "receiptId is required." };
  }
  const { checkPlanBacklogCoverage } = await import("@/lib/planning/plan-backlog-coverage");
  const result = await checkPlanBacklogCoverage({ itemId, planPath, receiptId });
  if (!result.ok) {
    return { success: false, error: result.code, message: result.error, data: result as unknown as Record<string, unknown> };
  }
  return {
    success: true,
    entityId: receiptId,
    message: `Plan backlog coverage is current for ${itemId}.`,
    data: result as unknown as Record<string, unknown>,
  };
}

async function checkBranchPlanBacklogGateTool(params: Record<string, unknown>): Promise<ToolResult> {
  const branchName = String(params["branchName"] ?? "").trim();
  if (!branchName || branchName === "main") {
    return { success: false, error: "invalid_branch", message: "A topic branchName is required." };
  }
  const { checkBranchPlanBacklogGate } = await import("@/lib/planning/plan-backlog-coverage");
  const result = await checkBranchPlanBacklogGate({ branchName });
  if (!result.ok) {
    return { success: false, error: result.code, message: result.error, data: result as unknown as Record<string, unknown> };
  }
  return {
    success: true,
    entityId: result.itemId,
    message: result.required
      ? `xlarge planning coverage is current for ${result.itemId}.`
      : "No xlarge planning coverage decision is required for this branch.",
    data: result as unknown as Record<string, unknown>,
  };
}

async function recordDecompositionOverrideTool(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const buildId = String(params["buildId"] ?? "");
  const rationale = String(params["rationale"] ?? "");
  if (!buildId.startsWith("FB-")) {
    return { success: false, error: "invalid_buildId", message: "buildId must use the FB-* format." };
  }
  const { recordDecompositionOverride } = await import("@/lib/build/decomposition-override");
  const result = await recordDecompositionOverride({
    buildId,
    rationale,
    userId,
    agentId: context?.agentId ?? null,
  });
  if (!result.ok) {
    return { success: false, error: result.code, message: result.error };
  }
  return {
    success: true,
    entityId: buildId,
    message: `Decomposition override recorded for ${buildId}.`,
    data: { override: result.override },
  };
}

async function recordPlanBacklogCoverageTool(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const itemId = String(params["itemId"] ?? "");
  const planPath = String(params["planPath"] ?? "");
  const decision = params["decision"];
  const deliverables = params["deliverables"];
  const planArtifactRef = params["planArtifactRef"];
  if (!itemId.startsWith("BI-")) {
    return { success: false, error: "invalid_itemId", message: "itemId must use the BI-* format." };
  }
  if (!planPath) return { success: false, error: "invalid_plan_path", message: "planPath is required." };
  if (decision !== "decomposed" && decision !== "atomic") {
    return { success: false, error: "invalid_decision", message: "decision must be decomposed or atomic." };
  }
  if (!Array.isArray(deliverables)) {
    return { success: false, error: "invalid_deliverables", message: "deliverables must be an array." };
  }
  if (!planArtifactRef || typeof planArtifactRef !== "object") {
    return { success: false, error: "invalid_plan_artifact", message: "planArtifactRef is required." };
  }
  const { recordPlanBacklogCoverage } = await import("@/lib/planning/plan-backlog-coverage");
  const result = await recordPlanBacklogCoverage({
    itemId,
    planPath,
    planArtifactRef: planArtifactRef as Parameters<typeof recordPlanBacklogCoverage>[0]["planArtifactRef"],
    decision,
    rationale: typeof params["rationale"] === "string" ? params["rationale"] : undefined,
    deliverables: deliverables as Parameters<typeof recordPlanBacklogCoverage>[0]["deliverables"],
    userId,
    agentId: context?.agentId ?? null,
  });
  if (!result.ok) {
    return {
      success: false,
      error: result.code,
      message: result.error,
      data: result as unknown as Record<string, unknown>,
    };
  }
  return {
    success: true,
    entityId: result.receiptId,
    message:
      result.decision === "atomic"
        ? `Recorded atomic plan coverage for ${itemId}.`
        : `Validated ${result.mappedItemIds.length} live BacklogItem mapping(s) for ${itemId}.`,
    data: {
      receiptId: result.receiptId,
      decision: result.decision,
      mappedItemIds: result.mappedItemIds,
    },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  assess_complexity: (params) => assessComplexityTool(params),
  propose_decomposition: (params) => proposeDecompositionTool(params),
  propose_build_decomposition: (params, userId, context) => proposeBuildDecomposition(params, userId, context),
  approve_decomposition: (params, userId, context) => approveDecompositionTool(params, userId, context),
  record_decomposition_override: (params, userId, context) => recordDecompositionOverrideTool(params, userId, context),
  record_plan_backlog_coverage: (params, userId, context) => recordPlanBacklogCoverageTool(params, userId, context),
  check_plan_backlog_coverage: (params) => checkPlanBacklogCoverageTool(params),
  check_branch_plan_backlog_gate: (params) => checkBranchPlanBacklogGateTool(params),
};

export const decompositionPack: ToolPack = {
  packId: "decomposition",
  definitions,
  handlers,
  grants: {
    assess_complexity: ["backlog_read"],
    propose_decomposition: ["backlog_write"],
    propose_build_decomposition: ["build_phase_advance"],
    approve_decomposition: ["build_phase_advance"],
    record_decomposition_override: ["build_phase_advance"],
    record_plan_backlog_coverage: ["backlog_write"],
    check_plan_backlog_coverage: ["backlog_read"],
    check_branch_plan_backlog_gate: ["backlog_read"],
  },
};
