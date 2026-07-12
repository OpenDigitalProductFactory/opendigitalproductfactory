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
    description: "Atomically create an execution-organizational Epic + N child FeatureBuilds + sibling-dependency edges from a pre-validated DecompositionCandidate, and mark the originating FeatureBuild as superseded. The originating build must be in `ideate` phase with a passed designReview, or in `plan` with a failed oscillating planReview as the retroactive escape hatch, and must not itself be a child. Callers (typically the decomposition assistant flow) supply the candidate after the operator has chosen and optionally edited it; all invariants from epic-decomposition-invariants run before any DB writes.",
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
    description: "Record the operator's 'keep as one build' override on a FeatureBuild whose size assessment is decompose-required. Writes designReview.decompositionOverride for audit and hive-contribution context. Only valid on decompose-required builds; recommended-tier builds proceed without recording an override (single-click path per spec §4.1). Does not enforce — the downstream decomposition gate is the consumer of this record.",
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
    },
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

const handlers: Record<string, ToolPackHandler> = {
  assess_complexity: (params) => assessComplexityTool(params),
  propose_decomposition: (params) => proposeDecompositionTool(params),
  propose_build_decomposition: (params, userId, context) => proposeBuildDecomposition(params, userId, context),
  approve_decomposition: (params, userId, context) => approveDecompositionTool(params, userId, context),
  record_decomposition_override: (params, userId, context) => recordDecompositionOverrideTool(params, userId, context),
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
  },
};
