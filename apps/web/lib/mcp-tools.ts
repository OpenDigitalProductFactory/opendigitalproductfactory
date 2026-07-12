import type { CapabilityKey } from "@/lib/permissions";
import { can, type UserContext } from "@/lib/permissions";
import { prisma } from "@dpf/db";
// Static import: executeTool is a hot path; dynamic import per call would hurt throughput.
import { evaluateExecution } from "@/lib/kernel/runtime-gate";
import { loadEnforceablePrinciples } from "@/lib/kernel/load-enforceable-principles";
import { detectSessionClass } from "@/lib/kernel/session-class";
import { kernelGateDecisionsTotal } from "@/lib/operate/metrics";
import * as crypto from "crypto";
import { lazyFs, lazyFsPromises, lazyPath, lazyChildProcess, lazyUtil, getCwd } from "@/lib/shared/lazy-node";
import { slugify } from "@/lib/shared/slugify";
import { mergeHappyPathStateIntoPlan, generateBuildId } from "@/lib/feature-build-types";
import { promoteBacklogItemToBuildDraft } from "@/lib/governed-backlog-tee-up";
import { recordExternalEvidence } from "@/lib/actions/external-evidence";
// BI-ARCH-TOOLPACKS: deliberation + SIEM are fully owned by the first scoped tool
// pack — their definitions compose into PLATFORM_TOOLS and their handlers dispatch
// through the registry (no per-tool handler imports or switch cases here anymore).
import { TOOL_PACK_REGISTRY } from "@/lib/mcp/pack-registry";
import type { ReviewBranchInput } from "@/lib/integrate/build-reviewers";
import { triggerDesignReviewAutoRepair, triggerPlanReviewAutoRepair } from "@/lib/integrate/pre-build-review-auto-repair";
import {
  getIntegrationBenchmarkMetadata,
  matchesIntegrationBenchmarkFilters,
  type IntegrationBenchmarkDomain,
  type IntegrationDeploymentMode,
  type IntegrationProfileTag,
  type IntegrationTreatment,
} from "@/lib/integrate/integration-benchmarking";
import { normalizeBuildPlanPaths } from "@/lib/integrate/build-plan-paths";
import {
  SANDBOX_RECOVERY_ACTIONS,
  isSandboxRecoveryAction,
} from "@/lib/integrate/sandbox/sandbox-admin-types";
import { getToolMarketplaceReadiness } from "@/lib/actions/tool-marketplace-readiness";
import { inferProviderIdFromRouteContext } from "@/lib/ai-provider-route-context";
// ─── Types ───────────────────────────────────────────────────────────────────
export type BuildPhaseTag = "ideate" | "plan" | "build" | "review" | "ship";
type ToolExecutionContext = {
  routeContext?: string;
  agentId?: string;
  threadId?: string;
  taskRunId?: string;
  /**
   * Caller attribution for the decision ledger (BI-0EEBA669). The MCP route
   * derives `callerClient` from the request User-Agent product token (e.g.
   * "claude-code/2.1", "codex-cli/0.9") and sets `authSource`/`apiTokenId`
   * from the resolved auth. In-portal callers leave these unset — the ledger
   * falls back to agentId/threadId, which the coworker loop already plumbs.
   */
  callerClient?: string;
  apiTokenId?: string;
  authSource?: string;
  suppressDesignReviewAutoRepair?: boolean; suppressPlanReviewAutoRepair?: boolean;
  /**
   * Build the user is currently messaging from. Plumbed by agentic-loop.ts
   * from runAgenticLoop's `featureBuildId` param so phase-scoped tools can
   * target the correct build instead of fishing for "latest in phase X" —
   * which silently cross-contaminates state when multiple concurrent builds
   * are in the same phase (BI-F4A30FCB, Dale dogfood 2026-05-24).
   */
  featureBuildId?: string;
};
/** MCP tool annotation hints (from MCP spec + n8n-MCP pattern).
 *  These let the agent router and governance layer make safety decisions
 *  without parsing the tool description text.
 *
 *  MCP-spec fields are advisory client hints, not server-side enforcement —
 *  the grant system in agent-grants.ts is the authoritative check.
 *  `irreversibleHint` is a DPF extension layered on top: every irreversible
 *  tool is also destructive, but not every destructive tool is irreversible.
 *  The envelope flow (Pseudo-User Contract spec §6.4 — BI-0F9C291C) uses
 *  irreversibleHint to enforce the typed-phrase hard floor — irreversible
 *  actions cannot be auto-approved by per-turn elevation. */
export type ToolAnnotations = {
  /** Tool only reads data — never mutates state */
  readOnlyHint?: boolean;
  /** Tool performs a destructive/irreversible action (delete, overwrite, deploy) */
  destructiveHint?: boolean;
  /** Calling the tool twice with the same input produces the same result */
  idempotentHint?: boolean;
  /** Tool reaches outside the platform boundary (network, external API) */
  openWorldHint?: boolean;
  /** DPF extension. Tool's effect cannot be undone by any existing inverse
   *  tool — e.g. data deletion with no soft-delete column, a network send
   *  that the recipient has already acted on, a financial transfer. Always
   *  implies `destructiveHint: true`. Used by the Pseudo-User Contract
   *  envelope flow (BI-0F9C291C) to require an explicit typed-phrase
   *  confirmation regardless of per-turn elevation. */
  irreversibleHint?: boolean;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredCapability: CapabilityKey | null;
  requiresExternalAccess?: boolean;
  executionMode?: "proposal" | "immediate";
  sideEffect?: boolean;
  /**
   * Tool captures the coworker's own recommendation or work product as a
   * structured artifact (e.g. save_marketing_review). Persistence-only; no
   * external action. Coworkers running in `advise` mode are still permitted
   * to call these tools because the recommendation IS the deliverable — the
   * advise/act distinction guards against acting on the outside world, not
   * against recording the advice the user explicitly asked for. The tool
   * remains `sideEffect: true` for MCP annotations and tool-execution
   * memory; this flag only exempts it from the advise-mode runtime filter.
   */
  coworkerArtifact?: boolean;
  /**
   * Tool hands a scoped sub-task to a NAMED peer coworker (delegation /
   * summon). Like `coworkerArtifact`, this is an advise-safe exemption: it
   * remains `sideEffect: true` for MCP annotations and tool-execution memory,
   * but is NOT stripped by the advise-mode runtime filter. Rationale
   * (BI-7EB4AE2C): naming the right peer and handing off a scoped sub-task —
   * with a visible handoff card the user sees inline — is COORDINATION, not an
   * irreversible action on the outside world. The advise/act line guards
   * against acting externally; routing work to a teammate is how an advisor
   * gets the user a better answer. Without this flag an advise-mode coworker
   * can NAME the right peer but the delegation is muzzled, so the sub-task
   * dead-ends back to the human. Genuinely destructive writes stay
   * `sideEffect: true` WITHOUT this flag and remain stripped in advise mode.
   */
  adviseCoordination?: boolean;
  /** When set, tool is only available during these build phases.
   *  Null/undefined = available in all phases (non-build tools). */
  buildPhases?: BuildPhaseTag[] | null;
  /** MCP-spec tool annotations for governance and safety classification */
  annotations?: ToolAnnotations;
  /** Pseudo-User Contract (spec §6.1 — BI-D9487754): the ScreenManifest
   *  surface this tool is meaningful in. Used by the manifest CI lint to
   *  validate that domain actions a manifest exposes have a matching tool
   *  entry, and by the chat handler to filter the tool catalog by current
   *  routeContext. Undefined = surface-agnostic (the tool is callable from
   *  any context — most tools fall here). */
  screenSurface?: string;
  /**
   * Predicate that lets an `executionMode: "proposal"` tool skip the proposal
   * card and execute immediately when the user has already pre-authorized the
   * action through platform configuration. Returning true means the agentic
   * loop treats this tool call as immediate; false (or undefined) preserves
   * the normal proposal-approval flow. Used for `contribute_to_hive` under
   * `contributionMode=contribute_all` — with DCO already accepted, the user
   * has given standing authorization for every shipped build to contribute
   * upstream, so the per-build proposal card is redundant ceremony that
   * silently stalls autonomous runs. The predicate also receives the pending
   * params (when available) so flows like `start_deliberation` can inspect
   * `triggerSource` to pre-authorize stage-default / risk-escalated runs.
   */
  autoApproveWhen?: (ctx: {
    userId: string;
    params?: Record<string, unknown>;
  }) => Promise<boolean>;
};

export type EndpointTestRunRequest = {
  endpointId?: string;
  modelId?: string;
  taskType?: string;
  probesOnly: boolean;
  allEndpoints: boolean;
  allModels: boolean;
  error?: string;
};

/** Derive tool annotations from existing ToolDefinition fields.
 *  Explicit `annotations` on a tool override these defaults. */
export function resolveAnnotations(tool: ToolDefinition): ToolAnnotations {
  const defaults: ToolAnnotations = {
    readOnlyHint: tool.sideEffect === false && tool.executionMode !== "proposal",
    destructiveHint: tool.executionMode === "proposal" || DESTRUCTIVE_TOOLS.has(tool.name),
    idempotentHint: tool.sideEffect === false,
    openWorldHint: tool.requiresExternalAccess === true,
  };
  return { ...defaults, ...tool.annotations };
}

// ─── Parameter Sanitization ─────────────────────────────────────────────────
// Models (especially Codex/GPT) often fill optional object parameters with empty
// strings as schema artifacts. This causes validation failures in handlers that
// check for the object's presence before inspecting its fields.
//
// sanitizeToolParams strips optional object params whose string fields are all
// empty/whitespace. Applied once at the executeTool entry point so every handler
// is protected without per-tool defensive code.

const _toolSchemaCache = new Map<string, { required: Set<string>; objectParams: string[] }>();

function _getToolParamMeta(toolName: string): { required: Set<string>; objectParams: string[] } {
  const cached = _toolSchemaCache.get(toolName);
  if (cached) return cached;

  const tool = PLATFORM_TOOLS.find(t => t.name === toolName);
  if (!tool) {
    const empty = { required: new Set<string>(), objectParams: [] };
    _toolSchemaCache.set(toolName, empty);
    return empty;
  }

  const schema = tool.inputSchema as {
    properties?: Record<string, { type?: string }>;
    required?: string[];
  };
  const required = new Set<string>(schema.required ?? []);
  const objectParams: string[] = [];
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (prop?.type === "object" && !required.has(key)) {
        objectParams.push(key);
      }
    }
  }
  const result = { required, objectParams };
  _toolSchemaCache.set(toolName, result);
  return result;
}

/**
 * Strip optional object parameters that are empty schema artifacts.
 * An object param is considered empty when all its string-typed values
 * are empty or whitespace-only. Returns a shallow copy with empty
 * objects removed; does not mutate the original.
 */
export function sanitizeToolParams(
  toolName: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const { objectParams } = _getToolParamMeta(toolName);
  if (objectParams.length === 0) return params;

  let cleaned: Record<string, unknown> | null = null;
  for (const key of objectParams) {
    const val = params[key];
    if (val == null || typeof val !== "object") continue;
    const obj = val as Record<string, unknown>;
    const stringValues = Object.values(obj).filter((v): v is string => typeof v === "string");
    // Object with at least one string field, all of which are empty → schema artifact
    if (stringValues.length > 0 && stringValues.every(s => s.trim() === "")) {
      if (!cleaned) cleaned = { ...params };
      delete cleaned[key];
      console.log(`[sanitize] ${JSON.stringify(toolName)}: stripped empty optional object param ${JSON.stringify(key)}`);
    }
  }
  return cleaned ?? params;
}

export function resolveSavePhaseHandoffTransition(
  params: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
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

/** Tools that perform destructive or irreversible actions beyond what
 *  sideEffect/executionMode already captures. Used by resolveAnnotations
 *  to set destructiveHint on tools that don't carry an explicit
 *  `annotations` block. */
const DESTRUCTIVE_TOOLS = new Set([
  "deploy_feature",
  "execute_promotion",
  "transition_employee_status",
  "contribute_to_hive",
  "apply_platform_update",
  // Pseudo-User Contract (BI-B2F7ABF5): build-phase and lifecycle ops that
  // advance the FeatureBuild state machine are destructive in the
  // can't-quietly-take-back sense. Promote/process write FeatureBuild rows
  // and dispatch coworker work; approve_decomposition commits the
  // decomposition that drives the Plan phase; start_build kicks off the
  // sandbox/code-generation chain.
  "promote_to_build_studio",
  "process_backlog_for_build_studio",
  "approve_decomposition",
  "start_build",
]);

export type ToolResult = {
  success: boolean;
  entityId?: string;
  message: string;
  error?: string;
  data?: Record<string, unknown>;
};

function cleanEndpointTestString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function inferEndpointIdFromRouteContext(routeContext?: string): string | null {
  return inferProviderIdFromRouteContext(routeContext);
}

export function buildEndpointTestRunRequest(
  params: Record<string, unknown>,
  context?: { routeContext?: string },
): EndpointTestRunRequest {
  const explicitEndpointId = cleanEndpointTestString(params["endpointId"]);
  const inferredEndpointId = inferEndpointIdFromRouteContext(context?.routeContext) ?? undefined;
  const endpointId = explicitEndpointId ?? inferredEndpointId;
  const modelId = cleanEndpointTestString(params["modelId"]);
  const taskType = cleanEndpointTestString(params["taskType"]);
  const allEndpoints = endpointId ? false : params["allEndpoints"] === true;

  const base: EndpointTestRunRequest = {
    probesOnly: params["probesOnly"] === false ? false : true,
    allEndpoints,
    allModels: params["allModels"] === true,
    ...(endpointId ? { endpointId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(taskType ? { taskType } : {}),
  };

  if (!endpointId && !allEndpoints) {
    return {
      ...base,
      error: "run_endpoint_tests requires endpointId or allEndpoints=true when it is not used from a provider detail route.",
    };
  }

  return base;
}

async function resolveRepresentativeEndpointModelId(endpointId: string): Promise<string | undefined> {
  const orderBy = [
    { toolFidelity: "desc" as const },
    { reasoning: "desc" as const },
    { conversational: "desc" as const },
    { modelId: "asc" as const },
  ];

  const toolCapable = await prisma.modelProfile.findFirst({
    where: { providerId: endpointId, modelStatus: "active", supportsToolUse: true },
    orderBy,
    select: { modelId: true },
  });
  if (toolCapable?.modelId) return toolCapable.modelId;

  const active = await prisma.modelProfile.findFirst({
    where: { providerId: endpointId, modelStatus: "active" },
    orderBy,
    select: { modelId: true },
  });
  return active?.modelId;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// ─── Tool Registry ───────────────────────────────────────────────────────────
// Scoped tool packs compose into the registry; mcp-tools.ts is the thin layer
// over them (definitions spread into PLATFORM_TOOLS below; dispatch in executeTool).

export const PLATFORM_TOOLS: ToolDefinition[] = [
  ...TOOL_PACK_REGISTRY.definitions,
  {
    name: "promote_to_build_studio",
    description: "Promote a triaged backlog item (status=open, triageOutcome=build) to a FeatureBuild in Build Studio. Runs the Definition of Ready capacity check under an advisory-lock transaction. Authority-gated via the build_promote grant category.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The item ID to promote" },
      },
      required: ["itemId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
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
          description: "The DecompositionCandidate to materialize. See apps/web/lib/build/decomposition-candidates.ts for the full shape.",
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
  {
    name: "create_digital_product",
    description: "Register a new digital product in the inventory",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Product name" },
        productId: { type: "string", description: "Unique product identifier" },
        lifecycleStage: { type: "string", enum: ["plan", "design", "build", "production", "retirement"] },
        portfolioSlug: { type: "string", description: "Portfolio slug to assign to" },
      },
      required: ["name", "productId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "update_lifecycle",
    description: "Update a digital product's lifecycle stage and status",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Product identifier" },
        lifecycleStage: { type: "string", enum: ["plan", "design", "build", "production", "retirement"] },
        lifecycleStatus: { type: "string", enum: ["draft", "active", "inactive"] },
      },
      required: ["productId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "verify_live_install_readiness",
    description:
      "Preflight a feature against the live install before driving its happy path. Returns the same deterministic verdict as `pnpm verify:preflight` — CAN-TEST (served bytes contain the feature commit), MUST-ADVANCE (behind/unprovable → advance via the governed self-upgrade path), or BLOCKED (no testable runtime → file a BI and stop) — plus one next action. Surface-agnostic: identical verdict logic for CLI and in-portal/Build Studio. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        featureSha: {
          type: "string",
          description:
            "The commit the feature under test requires — a PR/BI merge SHA or a build's commit. Compared against the live install's served image identity.",
        },
      },
      required: ["featureSha"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "record_execution_evidence",
    description: "Attach an evidence record to a backlog item (test pass/fail, build pass/fail, ux verification, spec review, manual check, external link). Writes an evidence activity row; the cross-cutting audit lives in ToolExecution. Side-effecting.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "Semantic backlog item id" },
        kind: {
          type: "string",
          enum: [
            "test_pass",
            "test_fail",
            "build_pass",
            "build_fail",
            "ux_verified",
            "spec_review",
            "manual_check",
            "external_link",
          ],
          description: "Evidence kind",
        },
        summary: { type: "string", description: "Headline for the timeline (<= 240 chars)" },
        url: { type: "string", description: "Link to PR / CI run / screenshot" },
        body: { type: "string", description: "Longer notes (<= 8000 chars)" },
        toolExecutionId: { type: "string", description: "Audit row id when this evidence was produced by a prior tool call" },
      },
      required: ["itemId", "kind", "summary"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
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
  {
    name: "record_local_integration_result",
    description: "Record the result of a local merged-code integration gate before push or PR. Captures candidate branch, mode, status (passed | failed | conflict | blocked_sandbox_drift — the latter means the shared sandbox was stale/not-ready and the run is NOT product evidence), and evidence including dependency-freshness verdict.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["build-studio", "claude", "codex", "grok", "coworker"] },
        externalSessionId: { type: "string" },
        routeContext: { type: "string" },
        buildId: { type: "string" },
        taskRunId: { type: "string" },
        candidateBranch: { type: "string" },
        mode: { type: "string", enum: ["single-branch", "sibling-set", "post-merge-main"] },
        status: { type: "string", enum: ["passed", "failed", "conflict", "blocked_sandbox_drift"] },
        summary: { type: "string" },
        evidence: { type: "object" },
      },
      required: ["provider", "externalSessionId", "routeContext", "candidateBranch", "mode", "status", "summary", "evidence"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
  },
  {
    name: "record_functional_failure_evidence",
    description: "Create or update a deduped backlog item from Playwright FunctionalFailureEvidence. Uses a deterministic testId+route+actual fingerprint and records an evidence activity; the cross-cutting audit lives in ToolExecution. Side-effecting.",
    inputSchema: {
      type: "object",
      properties: {
        testId: { type: "string", description: "Stable automated test id" },
        suite: { type: "string", description: "Playwright suite or project" },
        route: { type: "string", description: "Application route under test" },
        expected: { type: "string", description: "Expected behavior" },
        actual: { type: "string", description: "Observed failure" },
        screenshotPath: { type: "string", description: "Local screenshot path when available" },
        tracePath: { type: "string", description: "Local trace path when available" },
        userRole: { type: "string", description: "User role used by the test" },
        agentId: { type: "string", description: "Expected or active coworker id" },
        routeContext: { type: "string", description: "Route context used by the test" },
        reproCommand: { type: "string", description: "Command to reproduce the failure" },
        createdAt: { type: "string", description: "Evidence timestamp" },
        likelyOwnerArea: { type: "string", description: "Likely owning product area" },
        buildId: { type: "string", description: "Optional Build Studio id" },
        backlogItemId: { type: "string", description: "Optional explicit backlog item to attach to" },
      },
      required: [
        "testId",
        "suite",
        "route",
        "expected",
        "actual",
        "userRole",
        "routeContext",
        "reproCommand",
        "createdAt",
        "likelyOwnerArea",
      ],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "get_finance_period_summary",
    description: "Return verified income, expenses, and net for a finance period (defaults to month-to-date). Income = sum of paid invoices; expenses = sum of paid bills + paid expense claims; net = income - expenses. Includes pending receivables/payables, multi-currency flags, source paths, and explicit gap descriptions when activity is missing. Use this whenever the user asks for a P&L figure, income vs expenses, or net cash position for a period - it is the canonical numeric answer for the Finance Specialist coworker.",
    inputSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["month-to-date", "last-month", "quarter-to-date", "year-to-date"],
          description: "Preset period. Defaults to month-to-date. Ignored when startDate/endDate are provided.",
        },
        startDate: {
          type: "string",
          description: "ISO date (e.g. 2026-05-01). When set, period is treated as a custom window. endDate is required alongside.",
        },
        endDate: {
          type: "string",
          description: "ISO date for the end of the custom window. Must be on or after startDate.",
        },
      },
      required: [],
    },
    requiredCapability: "view_finance",
    executionMode: "immediate",
    sideEffect: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "drive_browser_task",
    description:
      "Drive an authenticated browser to perform a bounded task on an auth-walled site (supplier portal, Substack, ad dashboard) that has no usable API. Picks the means by a governed decision, runs against a provisioned service-account profile (or the operator's attended session), and audits every action. Outward irreversible actions (publish/submit/send/order/configure) are NOT executed directly — they return awaiting-approval with an envelope the human approves first. Returns needs-provisioning when the site has no service-account profile yet (set one up in Service Account Browser Setup).",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Natural-language task for the browser, e.g. 'fill the newsletter draft title and body'." },
        siteKey: { type: "string", description: "Site identifier selecting the provisioned profile, e.g. 'substack'." },
        accountKey: { type: "string", description: "Account within the site. Defaults to 'default'." },
        targetDomains: { type: "array", items: { type: "string" }, description: "Navigation allowlist; the session may only drive these domains." },
        targetUrl: { type: "string", description: "Optional URL to open at." },
        kind: { type: "string", enum: ["read", "act"], description: "read = extract data only; act = drive (default)." },
        mode: { type: "string", enum: ["service-account", "operator-live"], description: "service-account (autonomous, default) or operator-live (attended)." },
        outwardAction: { type: "string", enum: ["publish", "submit", "send", "order", "configure"], description: "Set ONLY when the task takes an outward irreversible action — gates an approval envelope instead of acting." },
        renderedArtifact: { type: "object", description: "The exact payload the human approves at the destructive boundary (rendered post/form)." },
        rationale: { type: "string", description: "Why this action — recorded on the approval envelope." },
      },
      required: ["task", "siteKey", "targetDomains"],
    },
    requiredCapability: null,
    requiresExternalAccess: true,
    executionMode: "immediate",
    sideEffect: true,
  },
  // ─── Build Studio Tools ───────────────────────────────────────────────────
  // update_feature_brief and create_build_epic execute immediately (no approval dialog).
  // Only register_digital_product_from_build needs HITL approval (creates a real product).
  {
    name: "inspect_build_code_impact",
    description: "Analyze the active build's current diff and return route/schema impact plus code-graph coverage. Build ID is auto-resolved.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["review", "ship"],
  },
  {
    name: "update_feature_brief",
    description: "Save the Feature Brief for the current build. Build ID is auto-resolved.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Feature title" },
        description: { type: "string", description: "Plain-language feature description" },
        portfolioContext: { type: "string", description: "Portfolio slug that owns this feature. For internal platform/meta work (a change to Build Studio, the portal, or platform tooling itself) pass an empty string rather than forcing a customer-facing portfolio." },
        targetRoles: { type: "array", items: { type: "string" }, description: "Roles that will use this feature. For internal platform/meta work use internal operator roles (e.g. platform operator, admin) — never customer." },
        inputs: { type: "array", items: { type: "string" }, description: "User inputs the feature accepts" },
        dataNeeds: { type: "string", description: "What data the feature stores" },
        acceptanceCriteria: { type: "array", items: { type: "string" }, description: "What done looks like. Every requirement the user stated explicitly (exact formats, examples, behaviors) MUST appear as its own criterion, preserved faithfully — never substitute a different format or behavior for one the user specified." },
        fixContext: {
          type: "object",
          description: "For fix builds (kind=fix): the defect diagnosis. reproSteps, rootCause, and fixApproach are all required before a fix build can advance to plan. Merged into any existing fixContext, so partial updates accumulate.",
          properties: {
            reproSteps: { type: "string", description: "How to reproduce the defect" },
            expected: { type: "string", description: "Expected behavior" },
            actual: { type: "string", description: "Actual (buggy) behavior" },
            rootCause: { type: "string", description: "Identified root cause (file/function + why)" },
            fixApproach: { type: "string", description: "Smallest correct fix + regression test" },
            severity: { type: "string" },
          },
        },
      },
      required: ["title", "description", "portfolioContext", "targetRoles", "dataNeeds", "acceptanceCriteria"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate"],
  },
  {
    name: "register_digital_product_from_build",
    description: "Register or update a DigitalProduct from the current build. Build ID is auto-resolved. Requires approval.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Product name" },
        portfolioSlug: { type: "string", description: "Portfolio slug to assign to" },
      },
      required: ["name", "portfolioSlug"],
    },
    requiredCapability: "manage_capabilities",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "create_build_epic",
    description: "Create an Epic and backlog items for a shipped build. All IDs are auto-resolved.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Epic title" },
      },
      required: ["title"],
    },
    requiredCapability: "manage_capabilities",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  // ─── Intake Tools ─────────────────────────────────────────────────────────
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
  // ─── Build Notes Tool ───────────────────────────────────────────────────
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
  // ─── Phase Handoff Tool (Claude Code-inspired cross-phase memory) ────────
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
    name: "get_build_progress_visibility",
    description: "Read the Build Studio progress projection for a build: source-labelled DB task progress, stale chat conflicts, sandbox state, dispatch history, scoped verification, and quiet-agent status.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "verification_preflight",
    description: "Deterministic verify-phase preflight (EP-VERIFY-PROC). Returns MUST_ADVANCE (evidence already sufficient — do not re-test), BLOCKED (a prerequisite is missing — report it, do not fabricate a result), or CAN_TEST (proceed to functional verification). Call this BEFORE attempting verification so testability is a procedural verdict, not a judgment call.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["build", "review"],
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "get_build_sandbox_state",
    description: "Read the source-bounded sandbox/git state for a Build Studio build, including branch, head SHA, source diffstat, ignored generated/dependency paths, and expected plan files.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "get_build_dispatch_history",
    description: "Read bounded codex-dispatch attempts for a Build Studio build, including model, duration, exit code, sanitized stdout/stderr excerpts, and classified failure axis.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "get_build_scoped_verification",
    description: "Read build-scoped verification for a Build Studio build, separating failures on the build's changed surface from workspace-wide/global-health noise.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "list_build_activity_since",
    description: "List recent BuildActivity rows for a Build Studio build after an optional ISO timestamp cursor. Use this for polling-friendly observer updates.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
        cursor: { type: "string", description: "Optional ISO timestamp cursor; only rows after this timestamp are returned." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  // ─── Build Studio Lifecycle Tools (EP-SELF-DEV-002) ───────────────────────
  {
    name: "saveBuildEvidence",
    description: "Save evidence to a FeatureBuild record. ALWAYS pass both `field` and `value` — calls with empty `{}` are rejected. Example: `{field: \"designDoc\", value: {problemStatement: \"...\", existingFunctionalityAudit: \"...\", reusePlan: \"...\", proposedApproach: \"...\", acceptanceCriteria: [\"...\"]}}`. Valid fields: designDoc, designReview, buildPlan, planReview, taskResults, verificationOut, acceptanceMet.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
        field: { type: "string", enum: ["designDoc", "designReview", "buildPlan", "planReview", "taskResults", "verificationOut", "acceptanceMet"], description: "Evidence field to update — required" },
        value: { type: "object", description: "JSON value to store — required, do not omit. Shape varies by field; for designDoc use {problemStatement, existingFunctionalityAudit, reusePlan, proposedApproach, acceptanceCriteria[]}, for buildPlan use {fileStructure[], tasks[]} arrays." },
      },
      required: ["field", "value"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Internal build workflow — available in advise mode
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
  },
  {
    name: "reviewDesignDoc",
    description: "Submit the design document for AI review. Returns pass/fail with issues.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Internal build workflow — available in advise mode
    buildPhases: ["ideate"],
  },
  {
    name: "reviewBuildPlan",
    description: "Submit the implementation plan for AI review. Returns pass/fail with issues.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Internal build workflow — available in advise mode
    buildPhases: ["plan"],
  },
  {
    name: "diagnose_sandbox",
    description: "Diagnose Build Studio sandbox readiness for the active build. Returns the authoritative state, failed checks, and governed recovery actions; use this instead of asking the operator to run Docker commands.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
        expectedWorkspaceRoot: { type: "string", description: "Optional host worktree path expected to own the sandbox Compose project." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["build", "review", "ship"],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "recover_sandbox",
    description: "Run a governed Build Studio sandbox recovery action for the active build. Requires structured confirmation for destructive actions and records recovery activity instead of sending Docker instructions to the operator.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
        action: {
          type: "string",
          enum: [...SANDBOX_RECOVERY_ACTIONS],
          description: "Governed sandbox recovery action to run.",
        },
        confirmation: {
          type: "object",
          description: "Structured confirmation for destructive actions, e.g. { discardSandboxChanges: true, acknowledgeReset: true, reason: '...' }.",
          properties: {
            discardSandboxChanges: { type: "boolean" },
            acknowledgeReset: { type: "boolean" },
            reason: { type: "string" },
          },
        },
      },
      required: ["action"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["build", "review", "ship"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  {
    name: "reconcile_build_engines",
    description: "Re-provision build engines that were provisioned on demand and are now missing from the sandbox (e.g. after a sandbox rebuild). Idempotent and narrow: only restores engines with desired=present AND a prior successful provision that a fresh probe reports absent — a no-op for fresh or baked-only sandboxes. Side-effecting (may run installs). Also fires automatically when start_sandbox brings a recreated sandbox to ready. Returns { checked, restored[], skipped }.",
    inputSchema: {
      type: "object",
      properties: {
        offline: {
          type: "boolean",
          description: "When true, only use no-egress (prestaged-binary) recipes. Default false.",
        },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review"],
  },
  {
    name: "provision_build_engine",
    description: "Install a build-dispatch engine (claude, codex, grok, opencode) into the running sandbox from its registry recipe, then verify by re-probing. Idempotent — a no-op if the engine is already present. Side-effecting: runs the install command (e.g. `npm install -g`, the grok curl-installer, or the opencode prestaged-binary/tarball) inside the sandbox, so it requires sandbox_execute. Pass offline:true to use only no-egress (prestaged-binary) recipes for air-gapped installs. Returns { kind, version, recipe }.",
    inputSchema: {
      type: "object",
      properties: {
        engineId: { type: "string", description: "Engine to provision: 'claude' | 'codex' | 'grok' | 'opencode'." },
        offline: {
          type: "boolean",
          description: "When true, only run no-egress (prestaged-binary) recipes (air-gapped install). Default false.",
        },
      },
      required: ["engineId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review"],
  },
  {
    name: "get_build_engine_readiness",
    description: "Report whether each build-dispatch engine (claude, codex, grok, opencode) is present and healthy in the build sandbox. Returns per-engine { present, version, lastProbedAt, bakeInDefault } from the last probe (BuildEngineState). Pass refresh:true to live re-probe each engine (docker exec <verifyCommand>) and persist the fresh result. Use this to see engine readiness before selecting a build dispatch engine — e.g. an engine that is selectable but shows present:false would fail at runtime with 'not found'.",
    inputSchema: {
      type: "object",
      properties: {
        refresh: {
          type: "boolean",
          description: "When true, live re-probe each engine in the sandbox and persist the result before returning. Default false (return last known state).",
        },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review"],
  },
  {
    name: "check_sandbox",
    description: "Check whether the sandbox container (dpf-sandbox-1) is running. Returns status: 'running', 'stopped', or 'not_found'. If the result is not_found or detached, call diagnose_sandbox for governed recovery guidance.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review"],
  },
  {
    name: "start_sandbox",
    description: "Start the sandbox container if it is stopped. If status is 'stopped', this will start it and wait up to 20 seconds for it to become ready. If status is 'not_found', call diagnose_sandbox because sandbox creation or rebinding is a platform-owned recovery action.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review"],
  },
  {
    name: "start_build",
    description: "Initialize the build workspace. Call this ONCE at the start of the build phase. Verifies the sandbox container is running and creates a git branch for this build. If it returns 'not running', call diagnose_sandbox and use the returned recovery actions.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build. Supply it to drive a specific build when several builds are in-flight (e.g. an autonomous batch)." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["build"],
  },
  {
    name: "run_sandbox_tests",
    description: "Run unit tests and typecheck inside the sandbox container. Set auto_fix to true to automatically diagnose and fix failures (up to 3 attempts).",
    inputSchema: {
      type: "object",
      properties: {
        auto_fix: { type: "boolean", description: "When true, automatically diagnose test failures and attempt fixes (max 3 retries). Default: false." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["build", "review"],
  },
  {
    name: "read_sandbox_file",
    description: "Read a file from the sandbox working copy (post-build/edit state). For reading pristine source during planning, prefer read_project_file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root, e.g. apps/web/lib/actions/crm.ts" },
        offset: { type: "number", description: "Start reading from this line number (1-based). Omit to read from beginning." },
        limit: { type: "number", description: "Maximum number of lines to read. Omit to read entire file. Use for large files." },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    // Intentionally NOT in "plan" — read_project_file covers planning reads
    // from the source tree without requiring the portal→sandbox volume
    // round-trip, and having both tools in the same phase caused codex to
    // split file reads across them and stall (FB-21EEA510 2026-04-20).
    buildPhases: ["build", "review"],
  },
  {
    name: "write_sandbox_file",
    description: "Create or overwrite a file in the sandbox workspace. Use this to create new files. For modifying existing files, prefer edit_sandbox_file for surgical edits.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root, e.g. apps/web/app/(shell)/complaints/page.tsx" },
        content: { type: "string", description: "The full file content to write" },
      },
      required: ["path", "content"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Sandbox only
    buildPhases: ["build", "review"],
  },
  {
    name: "edit_sandbox_file",
    description: "Edit an existing file in the sandbox. Two modes: (1) String mode: old_text + new_text for exact find-and-replace. (2) Line mode: start_line + end_line + new_content to replace a line range by number. Use line mode when string matching fails — line numbers from read_sandbox_file are reliable.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root" },
        old_text: { type: "string", description: "String mode: the exact text to find and replace" },
        new_text: { type: "string", description: "String mode: the replacement text" },
        replace_all: { type: "boolean", description: "String mode: replace all occurrences. Default: false." },
        start_line: { type: "number", description: "Line mode: first line to replace (1-indexed, from read_sandbox_file)" },
        end_line: { type: "number", description: "Line mode: last line to replace (inclusive)" },
        new_content: { type: "string", description: "Line mode: replacement content for the line range" },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Sandbox only
    buildPhases: ["build", "review"],
  },
  {
    name: "search_sandbox",
    description: "Search the sandbox working copy (post-build/edit state). For searching pristine source during planning, prefer search_project_files.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Text or regex pattern to search for" },
        glob: { type: "string", description: "File glob filter, e.g. '*.ts' or '*.tsx'" },
        maxResults: { type: "number", description: "Maximum results (default 20)" },
      },
      required: ["pattern"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    // Not in "plan" — search_project_files covers planning search.
    buildPhases: ["build"],
  },
  {
    name: "list_sandbox_files",
    description: "List files in the sandbox working copy (post-build/edit state). For listing pristine source during planning, prefer list_project_directory.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern, e.g. 'apps/web/lib/actions/*.ts' or '**/*.tsx'" },
      },
      required: ["pattern"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    // Not in "plan" — list_project_directory covers planning listing.
    buildPhases: ["build"],
  },
  {
    name: "run_sandbox_command",
    description: "Run a shell command inside the sandbox container. Use for build, test, lint, git diff, or any other verification. Returns stdout and stderr.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute in the sandbox, e.g. 'pnpm --filter web build' or 'git diff'" },
      },
      required: ["command"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Sandbox is isolated from production — safe in any mode
    buildPhases: ["build", "review"],
  },
  {
    name: "run_tool_script",
    description:
      "Run a short script that calls several READ-only tools and filters their results inside an isolated sandbox, returning only the small filtered result. Use instead of calling many read tools individually when results are large — e.g. scan N records and keep the few that match. The code is the body of an async run: call `await callTool(name, args)` for each tool, then `emit(value)` once with your final small result. Read-only: the script cannot call side-effecting tools. Disabled unless an operator has enabled it.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "Script body. You have `callTool(name, args)` (returns the tool's data) and `emit(value)` (return your final small result). Example: const r = await callTool('query_backlog', { status: 'open' }); emit(r.items.filter(i => i.priority === 'high').map(i => i.itemId));",
        },
        purpose: { type: "string", description: "One line describing what the script does (recorded for audit)." },
      },
      required: ["code"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // sandbox-isolated; inner calls are read-only + governed per call
  },
  {
    name: "validate_schema",
    description: "Validate the Prisma schema in the sandbox for common errors: missing inverse relations, undefined types, unindexed foreign keys. MUST be called before running prisma migrate. Returns specific errors with fix instructions.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["build"],
  },
  {
    name: "deploy_feature",
    description: "Extract the git diff from sandbox and deploy to the platform.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "manage_capabilities",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "create_portal_pr",
    description: "Create a pull request on the portal's own repository from the current build's diff. Runs pre-PR security gates (security scan, destructive ops, architecture compliance, dependency audit). If all gates pass and the build is fully verified, auto-merges via squash. If any gate fails, creates the PR with findings and requests human review.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "manage_capabilities",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "set_change_disposition",
    description: "Record the human's final call on whether the current change is kept private (on the user's own system) or shared with the community. Use after presenting the Keep/Share suggestion at ship time. A change must be 'shareable' before contribute_to_hive or a public-hive PR will share it; the default is 'private' (fail-closed), so inaction never shares.",
    inputSchema: {
      type: "object",
      properties: {
        disposition: { type: "string", enum: ["private", "shareable"], description: "'private' keeps the change on the user's system; 'shareable' clears it to be contributed to the community." },
        reason: { type: "string", description: "Optional short note on why this disposition was chosen." },
      },
      required: ["disposition"],
    },
    requiredCapability: "manage_capabilities",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  // ─── Email setup (PBI-INV-04 Phase 2) ──────────────────────────────────
  // Lets the onboarding/COO coworker walk a non-technical operator through
  // configuring their OWN outbound email (SMTP). Operator-only
  // (manage_provider_connections) + the `email_config` agent grant.
  {
    name: "setup_email",
    description:
      "Help the operator set up their OWN outbound email (SMTP) so the platform can send invoices, payment links, dunning, and approvals. Three actions: action='detect' identifies the provider from the organization's domain and returns the one credential the operator must obtain (e.g. a Google App Password); action='save' persists the SMTP settings the operator provides; action='test' sends a test email to confirm delivery. DPF never relays email on the operator's behalf — their own provider sends. Walk the operator through getting the credential in plain language before calling 'save'.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["detect", "save", "test"], description: "detect | save | test" },
        host: { type: "string", description: "SMTP host (save) — e.g. smtp.gmail.com" },
        port: { type: "number", description: "SMTP port (save) — default 587 (STARTTLS) or 465 (implicit TLS)" },
        secure: { type: "boolean", description: "Implicit TLS on port 465 (save)" },
        user: { type: "string", description: "SMTP username (save) — usually the full email address" },
        from: { type: "string", description: "From address (save) — e.g. 'Acme <billing@acme.com>'" },
        pass: { type: "string", description: "SMTP password / app password / API key (save). Leave blank to keep the existing one." },
        to: { type: "string", description: "Recipient for the test email (test)" },
      },
      required: ["action"],
    },
    requiredCapability: "manage_provider_connections",
    sideEffect: true,
  },
  // ─── Admin Coworker Tools (TAK-ADMIN-001) ──────────────────────────────
  // These tools are available on the /admin route for platform administration.
  // Tier 1 = read-only, Tier 2 = reversible, Tier 3 = destructive (sideEffect: true).
  {
    name: "admin_view_logs",
    description: "View recent logs from a Docker Compose service. Returns the last N lines (default 100).",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name: portal, sandbox, postgres, neo4j, qdrant, portal-init" },
        lines: { type: "number", description: "Number of lines to return (default 100, max 500)" },
      },
      required: ["service"],
    },
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "admin_query_db",
    description: "Run a read-only SQL query against the portal database. Only SELECT statements are permitted. Max 1000 rows.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL SELECT query to execute" },
      },
      required: ["sql"],
    },
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "admin_read_file",
    description: "Read a file within the project directory. Path must be relative to PROJECT_ROOT. Sensitive files (.env, *.key, *.pem) are excluded.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root, e.g. docker-compose.yml or apps/web/lib/mcp-tools.ts" },
        offset: { type: "number", description: "Start reading from this line number (1-based)" },
        limit: { type: "number", description: "Maximum number of lines to read" },
      },
      required: ["path"],
    },
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "admin_restart_service",
    description: "Restart a platform service's container. Use when a service is down or unhealthy and a restart is the indicated remediation.",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name: portal, sandbox, postgres, neo4j, qdrant" },
      },
      required: ["service"],
    },
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false, // Tier 2: reversible
  },
  {
    name: "admin_run_migration",
    description: "Run 'prisma migrate deploy' inside the portal container to apply pending database migrations.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false, // Tier 2: reversible
  },
  {
    name: "admin_run_seed",
    description: "Run the database seed script inside the portal container to populate reference data.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false, // Tier 2: reversible
  },
  {
    name: "admin_run_command",
    description: "Run a shell command in the project directory. Only docker compose, git, and pnpm commands are permitted. Destructive commands require user confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run (docker compose, git, or pnpm only)" },
      },
      required: ["command"],
    },
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: true, // Tier 3: potentially destructive
  },
  // ─── Scheduling & Release Tools (IT4IT §5.3-5.4) ───────────────────────
  {
    name: "check_deployment_windows",
    description: "Check available deployment windows for promoting changes to production. Returns current window status, blackout periods, and next available window time.",
    inputSchema: {
      type: "object",
      properties: {
        change_type: { type: "string", description: "RFC type: standard, normal, or emergency. Default: normal." },
        risk_level: { type: "string", description: "Risk level: low, medium, high, or critical. Default: low." },
      },
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["review", "ship"],
  },
  {
    name: "schedule_promotion",
    description: "Schedule an approved promotion for deployment during a specific window. Creates a calendar event for visibility.",
    inputSchema: {
      type: "object",
      properties: {
        promotion_id: { type: "string", description: "The promotion ID (CP-xxx) to schedule." },
      },
      required: ["promotion_id"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "execute_promotion",
    description: "Execute an approved promotion. Starts the autonomous promoter: backup DB, build new portal image from sandbox, swap containers, health check. Rolls back automatically on failure.",
    inputSchema: {
      type: "object" as const,
      properties: {
        promotion_id: { type: "string", description: "The promotion ID to execute (e.g. CP-xxxx)." },
        override_reason: { type: "string", description: "Reason for deploying outside a deployment window (optional, for emergency changes)." },
      },
      required: ["promotion_id"],
    },
    requiredCapability: "view_operations" as const,
    executionMode: "immediate" as const,
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "create_release_bundle",
    description: "Group multiple completed builds into a release bundle for coordinated deployment (IT4IT §5.3.5 Release Package).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Release bundle title, e.g. 'March 2026 Feature Release'." },
        build_ids: { type: "array", items: { type: "string" }, description: "Array of buildId values to include in the bundle." },
      },
      required: ["title", "build_ids"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "run_release_gate",
    description: "Run gate checks on a release bundle: combine diffs from all builds, run destructive operation scan, validate all builds passed tests (IT4IT §5.3.5 Accept & Publish Release).",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "The release bundle ID (RB-xxx) to check." },
      },
      required: ["bundle_id"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "schedule_release_bundle",
    description: "Schedule an approved release bundle for deployment during a deployment window. Creates an RFC, ChangePromotion, and CalendarEvent for operations calendar visibility.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "The release bundle ID (RB-xxx) to schedule." },
      },
      required: ["bundle_id"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "get_release_status",
    description: "Get the current status of a release bundle or promotion, including deployment window availability and gate check results.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "Release bundle ID (RB-xxx) — optional if promotion_id is provided." },
        promotion_id: { type: "string", description: "Promotion ID (CP-xxx) — optional if bundle_id is provided." },
      },
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ship"],
  },
  // ─── Hive Mind Contribution Tools (IT4IT §5.5 Release) ───────────────────
  // assess_contribution def moved to mcp/packs/contribution-hive-pack.ts
  // contribute_to_hive def moved to mcp/packs/contribution-hive-pack.ts
  {
    name: "run_ux_test",
    description: "Run natural-language UX test cases against the sandbox using AI-powered browser automation (browser-use). Each test case is a plain English assertion that the AI agent verifies by driving a real browser. Returns structured pass/fail results with screenshots. NOTE: UX verification runs automatically on review-phase entry via build/review.verify — this tool is retained for ad-hoc manual invocations only and is not in the review phase's tool allowlist.",
    inputSchema: {
      type: "object",
      properties: {
        tests: {
          type: "array",
          items: { type: "string" },
          description: "Natural-language test assertions. If omitted, auto-generates from acceptance criteria.",
        },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    // Empty buildPhases — the Inngest handler owns UX verification during
    // review; leaving this in the review allowlist leads to duplicate runs.
    // Kept callable outside a build phase for Dev-mode / debugging use.
    buildPhases: [],
  },
  // ─── Codebase Access Tools ──────────────────────────────────────────────────
  {
    name: "start_ideate_research",
    description: "Signal that you have enough context from the user to begin codebase research and draft the design document. Call this AFTER the user answers your questions (intent gate, reusability scope). The system will search the codebase, analyze patterns, and draft the design doc automatically. You do NOT need to call search_project_files or read_project_file yourself — this tool handles all research.",
    inputSchema: {
      type: "object",
      properties: {
        reusabilityScope: { type: "string", enum: ["one_off", "parameterizable", "already_generic"], description: "The user's reusability preference" },
        userContext: { type: "string", description: "Summary of what the user wants, including any answers to clarifying questions" },
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build (the ambient ideate conversation). Supply it to drive a specific build's research when several builds are in-flight (e.g. an autonomous 20-build batch)." },
      },
      required: ["reusabilityScope", "userContext"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate"],
  },
  {
    name: "start_scout_research",
    description: "Start a fast codebase scout + URL parse before asking clarification questions. Call this immediately after the user describes their feature. Returns immediately — results appear in Build Studio Context on the next turn.",
    inputSchema: {
      type: "object",
      properties: {
        externalUrls: {
          type: "array",
          items: { type: "string" },
          description: "Any URLs the user mentioned (website, design doc, reference). Will be fetched and parsed for domain structure.",
        },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate"],
  },
  // ─── Manifest Tools ────────────────────────────────────────────────────────
  {
    name: "propose_file_change",
    description: "Propose a change to a project file. Shows a diff for human review. Requires approval before the change is applied.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path to modify or create" },
        description: { type: "string", description: "Human-readable description of the change" },
        newContent: { type: "string", description: "The complete new file contents" },
      },
      required: ["path", "description", "newContent"],
    },
    requiredCapability: "manage_capabilities",
    sideEffect: true,
    buildPhases: ["build"],
  },
  // ─── Feedback Loop ──────────────────────────────────────────────────────────
  // propose_improvement def moved to mcp/packs/contribution-hive-pack.ts
  // propose_skill_improvement def moved to mcp/packs/contribution-hive-pack.ts
  // ─── Provider Management ────────────────────────────────────────────────────
  // submit_feedback def moved to mcp/packs/contribution-hive-pack.ts
  // ─── Principles-as-wiki-kind Phase 2 Task 2.7: advisory decision support ──
  {
    name: "principle_decide",
    description:
      "Advisory only. Score a set of options against the governance principles in scope for the calling population, and return a recommendation plus a per-principle contribution ledger. Uses commandments from Postgres (always included) and relevant core/contextual principles from semantic search. Does not execute the recommended option; the caller retains authority. Use when you have two or more options and want to surface which governance principles pull which way.",
    inputSchema: {
      type: "object",
      properties: {
        context: {
          type: "string",
          description:
            "A short description of the decision being made. Used for semantic retrieval of relevant core and contextual principles.",
        },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Stable identifier for the option." },
              description: { type: "string", description: "Short prose description." },
              features: {
                type: "object",
                description:
                  "Optional map of dimension key -> 0..1 score. Dimensions must come from the registry in packages/db/src/wiki-taxonomy.ts. Options that supply features get structured alignment; otherwise the math falls back to semantic alignment.",
                additionalProperties: { type: "number" },
              },
            },
            required: ["id", "description"],
          },
          description: "The candidate options to score. Must be a non-empty array.",
        },
        callingPopulation: {
          type: "string",
          enum: ["in_platform_coworker", "external_coding_agent", "human"],
          description: "Population whose principles should apply.",
        },
        maxPrinciples: {
          type: "number",
          description: "Cap on relevant core/contextual principles retrieved from Qdrant. Default 20.",
        },
        tieMargin: {
          type: "number",
          description:
            "Margin threshold below which confidence flips to 'low' and the reasoning recommends human review. Default 0.2.",
        },
        ringScope: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "ring-1-coworker",
              "ring-2-workflow",
              "ring-3-archetype",
              "ring-4-sandbox-prod",
              "ring-5-hive",
              "external-coordination",
              "universal-ring",
            ],
          },
          description:
            "Reduction Gear ring scope(s) the calling action binds. When set, retrieval filters to principles whose principleRingScope intersects the caller scope OR contains universal-ring OR is empty (backward compat). Omit (or pass ['universal-ring']) to consult the full kernel — appropriate for design-time / kernel-architecture decisions that genuinely bind every ring. See spec docs/superpowers/specs/2026-05-24-founder-kernel-evolution-discipline-design.md §5.",
        },
        callingSurface: {
          type: "string",
          description:
            "Optional free-form label naming the calling surface (e.g. 'build-studio-phase', 'promotion-gate'). Propagated to the [principle-recall-trace] log line so operators can correlate recall traffic with the surface that drove it.",
        },
      },
      required: ["context", "options", "callingPopulation"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  // ─── Endpoint Testing Tools ──────────────────────────────────────────────
  {
    name: "run_endpoint_tests",
    description: "Run the agent test harness against a scoped endpoint. On provider detail routes, omit endpointId to use the current provider and default to quick probes. Set allEndpoints=true or allModels=true only when the user explicitly asks for exhaustive diagnostics.",
    inputSchema: {
      type: "object",
      properties: {
        endpointId: { type: "string", description: "Provider endpoint to test. Defaults to the current /platform/ai/providers/:providerId route when available." },
        modelId: { type: "string", description: "Optional model profile to test. Defaults to a representative active model for the endpoint." },
        taskType: { type: "string", description: "Run only scenarios for this task type (default: all)" },
        probesOnly: { type: "boolean", description: "Run only capability probes, skip scenarios (default: true for coworker calls)" },
        allEndpoints: { type: "boolean", description: "Explicitly test every active LLM endpoint. Use only when the user asks for all endpoints." },
        allModels: { type: "boolean", description: "Test every active model profile for the endpoint. Use only for exhaustive diagnostics." },
      },
    },
    requiredCapability: "manage_capabilities",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "list_patch_posture",
    description:
      "Summarize estate patch posture: open patch findings (vulnerabilities, available updates, end-of-life) across discovered software, ranked by severity and active exploitation (CISA KEV).",
    inputSchema: {
      type: "object",
      properties: {
        severity: { type: "string", description: "Filter to one severity: critical|high|medium|low|info (optional)" },
        status: { type: "string", description: "open (default) or all to include resolved (optional)" },
      },
      required: [],
    },
    requiredCapability: "view_inventory",
    sideEffect: false,
  },

  // ─── Multi-Agent Collaboration Tools (EP-A2A, 2026-06-04 spec) ─────────────
  {
    name: "request_coworker",
    description:
      "Hand off a scoped sub-task to a NAMED peer coworker. Unlike spawn_work_thread (anonymous child), this targets a specific coworker by agentId or slug and emits a VISIBLE handoff the user sees inline. Use when you need another coworker's distinct capability (e.g. ask the Enterprise Architect to review a schema).",
    inputSchema: {
      type: "object",
      properties: {
        targetAgent: { type: "string", description: "Target coworker — canonical agentId (AGT-*) or slug alias (e.g. 'ea-architect')." },
        objective: { type: "string", description: "The scoped sub-task for the peer coworker." },
        questionPacketSummary: { type: "string", description: "Optional one-line summary of the intent/question shown on the handoff card." },
        tier: { type: "number", enum: [2, 3], description: "Interaction tier (default 2). Tier 3 requires depth-2 spawn support." },
        enteredVia: { type: "string", enum: ["handoff", "escalation", "spawn"], description: "How the peer is entering (default 'handoff')." },
      },
      required: ["targetAgent", "objective"],
    },
    requiredCapability: null,
    sideEffect: true,
    // Delegation is advise-safe coordination — an advisor may route a scoped
    // sub-task to a named peer with a visible handoff without leaving advise
    // mode. Kept sideEffect:true for annotations; adviseCoordination exempts it
    // from the advise-mode runtime filter (BI-7EB4AE2C).
    adviseCoordination: true,
  },
  {
    name: "summon_coworker",
    description:
      "Bring a NAMED coworker into the current conversation as a second/third-tier participant to address part of the work, emitting a VISIBLE summon the user sees inline. YOU (the active coworker) decide which peer to bring in and what to task them with — this is your responsibility, not the user's. Use when a request needs a peer's distinct capability alongside you in the conversation.",
    inputSchema: {
      type: "object",
      properties: {
        targetAgent: { type: "string", description: "Target coworker — canonical agentId (AGT-*) or slug alias." },
        objective: { type: "string", description: "What the summoned coworker should address." },
        tier: { type: "number", enum: [2, 3], description: "Interaction tier (default 2)." },
      },
      required: ["targetAgent", "objective"],
    },
    requiredCapability: null,
    sideEffect: true,
    // Bringing a named peer into the conversation is advise-safe coordination —
    // the advisor decides which teammate to pull in; the handoff is visible and
    // reversible. Kept sideEffect:true for annotations; adviseCoordination
    // exempts it from the advise-mode runtime filter (BI-7EB4AE2C).
    adviseCoordination: true,
  },
  {
    name: "trigger_contributor_inventory_sync",
    description:
      "Dispatch an on-demand contributor inventory sync (git worktrees, branches, GitHub PRs) without waiting for the 10-minute cron. Used by agents that just made an external change (pushed a branch, opened a PR) and want the /platform/development/change-lanes dashboard to reflect it on the next refresh. Returns the Inngest event id immediately; the runner creates the ContributorInventorySyncRun row asynchronously.",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Optional short tag propagated to the run row's triggeredBy field for audit.",
        },
      },
    },
    requiredCapability: "manage_provider_connections",
    executionMode: "immediate",
    sideEffect: true,
  },
];

// ─── Capability Filtering ────────────────────────────────────────────────────

export async function getAvailableTools(
  userContext: UserContext,
  options?: {
    externalAccessEnabled?: boolean;
    mode?: "advise" | "act";
    unifiedMode?: boolean;
    agentId?: string;
    /**
     * Extra grants to union with the agent's own grants before tool gating.
     * Used by the coworker path to apply COWORKER_READ_BASELINE_GRANTS so every
     * coworker can read its page data, docs, source, and the code graph
     * (BI-FD7E4D72). Read-only by construction; the user-capability check above
     * still bounds what the human operator may see.
     */
    additionalGrants?: readonly string[];
  },
): Promise<ToolDefinition[]> {
  let platformTools = PLATFORM_TOOLS.filter(
    (tool) =>
      (options?.unifiedMode || !tool.requiresExternalAccess || options?.externalAccessEnabled === true)
      && (tool.requiredCapability === null || can(userContext, tool.requiredCapability))
      && (options?.mode !== "advise" || !tool.sideEffect),
  );

  // Agent-scoped filtering: intersection of user capabilities and agent tool grants.
  // EP-AI-WORKFORCE-001: use the async DB-first resolver so grants written via
  // the DB (e.g. via seed or Admin UI) take precedence over the JSON fallback.
  const { getAgentToolGrantsAsync, isToolAllowedByGrants, getToolGrantMapping } =
    await import("./agent-grants");
  let agentGrants: string[] = [];
  if (options?.agentId) {
    agentGrants = await getAgentToolGrantsAsync(options.agentId);
    // Union the agent's own grants with any baseline read grants (the coworker
    // path passes COWORKER_READ_BASELINE_GRANTS). Done here so the merged set is
    // also used by the discovered-MCP-tool gating below. The merge only widens
    // toward read-only tools; agents that hold no grants AND get no baseline are
    // left ungated exactly as before (length-0 → no filtering).
    if (options.additionalGrants?.length) {
      agentGrants = Array.from(new Set([...agentGrants, ...options.additionalGrants]));
    }
    if (agentGrants.length > 0) {
      platformTools = platformTools.filter((tool) => isToolAllowedByGrants(tool.name, agentGrants));
    }
  }

  if (options?.externalAccessEnabled) {
    try {
      const { getMcpServerTools } = await import("./mcp-server-tools");
      const mcpTools = await getMcpServerTools();
      const modeFiltered = options?.mode === "advise" ? [] : mcpTools;
      // Grant-gate discovered MCP tools, closing the Verdict 5 authority gap
      // (EP-BROWSER-DRIVE, spec 2026-06-05 §8.2). Previously every discovered
      // MCP tool was appended ungated whenever External Access was on — so a
      // side-effecting browser tool was ambiently callable. Now a discovered
      // tool that carries a TOOL_TO_GRANTS entry (the namespaced browser-driving
      // tools) is denied unless the agent holds the grant; this denies them even
      // for an agent with no grants at all (empty agentGrants → false). Discovered
      // tools WITHOUT a mapping retain prior behavior so other MCP servers are not
      // regressed — tightening those to default-deny is tracked separately
      // (architect review Slice 0 item 4, the discovered-tool policy overlay).
      const grantMap = getToolGrantMapping();
      const grantFiltered = modeFiltered.filter((tool) =>
        grantMap[tool.name] ? isToolAllowedByGrants(tool.name, agentGrants) : true,
      );
      return [...platformTools, ...grantFiltered];
    } catch {
      // MCP server tools unavailable — return platform tools only
    }
  }

  return platformTools;
}

// ─── Tool Execution ──────────────────────────────────────────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fire-and-forget: log tool activity for the Build Studio activity timeline. */
function logBuildActivity(buildId: string, tool: string, summary: string): void {
  prisma.buildActivity.create({ data: { buildId, tool, summary } }).catch(() => {});
}

function logAdminActivity(
  userId: string, toolName: string, parameters: Record<string, unknown>,
  result: string, tier: number, summary?: string,
): Promise<void> {
  return prisma.adminActivity.create({
    data: { userId, toolName, parameters: parameters as any, result, tier, summary: summary?.slice(0, 500) },
  }).then(() => {}).catch(() => {});
}

/**
 * Phases that exclude a FeatureBuild from "active" auto-resolution.
 * `abandoned` is included because abandoned builds from prior runs would
 * otherwise shadow the freshly promoted build (BI-E9CD1B92, 2026-05-13).
 */
const TERMINAL_BUILD_PHASES = ["complete", "failed", "abandoned"] as const;

/**
 * Pull a well-formed `buildId` hint out of a tool's params bag.
 * Returns null when the hint is missing, non-string, or doesn't have the
 * `FB-` prefix that all real FeatureBuild IDs carry.
 */
function extractBuildIdHint(params: Record<string, unknown>): string | null {
  const v = params["buildId"];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.startsWith("FB-") ? trimmed : null;
}

/**
 * Resolve the active FeatureBuild for the current user.
 *
 * When `buildIdHint` is supplied AND it resolves to an existing build the
 * caller is allowed to act on, that hint wins — even if the user has a more
 * recently updated build. This is how explicit `buildId` arguments from MCP
 * tool calls reach the per-tool handlers without being silently overridden
 * (the bug behind FB-1D69766D returning FB-72EB9C06's review).
 *
 * Fallback: most-recently-updated non-terminal build created by the user.
 */
async function resolveActiveBuildId(
  userId: string,
  buildIdHint?: string | null,
): Promise<string | null> {
  if (buildIdHint && buildIdHint.startsWith("FB-")) {
    const hinted = await prisma.featureBuild.findUnique({
      where: { buildId: buildIdHint },
      select: { buildId: true, createdById: true },
    });
    // Access model today is owner-only — see getFeatureBuildForContext for the
    // matching check. If a future grant model lands, expand this predicate.
    if (hinted && hinted.createdById === userId) return hinted.buildId;
  }
  const build = await prisma.featureBuild.findFirst({
    where: { createdById: userId, phase: { notIn: [...TERMINAL_BUILD_PHASES] } },
    orderBy: { updatedAt: "desc" },
    select: { buildId: true },
  });
  return build?.buildId ?? null;
}

async function updateBuildHappyPathState(
  userId: string,
  patch: Parameters<typeof mergeHappyPathStateIntoPlan>[1],
  buildId?: string | null,
): Promise<void> {
  const resolvedBuildId = buildId ?? await resolveActiveBuildId(userId);
  if (!resolvedBuildId) return;

  const build = await prisma.featureBuild.findUnique({
    where: { buildId: resolvedBuildId },
    select: { plan: true },
  });
  if (!build) return;

  const mergedPlan = mergeHappyPathStateIntoPlan(
    (build.plan as Record<string, unknown> | null) ?? null,
    patch,
  );

  await prisma.featureBuild.update({
    where: { buildId: resolvedBuildId },
    data: { plan: mergedPlan as import("@dpf/db").Prisma.InputJsonValue },
  });
}

function redactFunctionalFailureText(text: string): string {
  return text
    .replace(/\bdpfmcp_[A-Za-z0-9_-]+/g, "[redacted-token]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/g, "[redacted-token]");
}

// BI-F4A30FCB (Dale dogfood 2026-05-24): see ideate-build-resolution.ts for
// the why. Re-exported here so existing imports keep working; new callers
// should import from "@/lib/build/ideate-build-resolution".
import { resolveIdeateBuildForToolPure } from "@/lib/build/ideate-build-resolution";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export async function resolveIdeateBuildForTool(args: {
  contextBuildId?: string;
  toolName: string;
}) {
  return resolveIdeateBuildForToolPure(args, {
    findUniqueBuild: async (buildId) =>
      prisma.featureBuild.findUnique({
        where: { buildId },
        select: { buildId: true, phase: true },
      }),
    findIdeateBuilds: async () =>
      prisma.featureBuild.findMany({
        where: { phase: "ideate" },
        orderBy: { updatedAt: "desc" },
        select: { buildId: true },
        take: 2, // only need to distinguish 0 / 1 / 2+
      }),
  });
}

export async function executeTool(
  toolName: string,
  rawParams: Record<string, unknown>,
  userId: string,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  // Strip empty optional object params that models send as schema artifacts
  const params = sanitizeToolParams(toolName, rawParams);

  // ─── Build-context hint (BI-2DAB02B4 / BI-F4A30FCB) ────────────────────────
  // When the coworker is messaging from a specific build, that build is plumbed
  // here as context.featureBuildId (a cuid). Resolve it to the FB- buildId and
  // set params.buildId so phase-scoped tools (update_feature_brief,
  // reviewDesignDoc, saveBuildEvidence, …) target THAT build via
  // extractBuildIdHint — instead of resolveActiveBuildId silently falling back
  // to the user's most-recently-updated non-terminal build, which
  // cross-contaminates when several builds are active (the wrong-build-context
  // bug). Only fills when the caller didn't pass an explicit buildId, and is
  // inert for non-build tools (they never read params.buildId).
  if (context?.featureBuildId && typeof params["buildId"] !== "string") {
    try {
      const ctxBuild = await prisma.featureBuild.findUnique({
        where: { id: context.featureBuildId },
        select: { buildId: true },
      });
      if (ctxBuild?.buildId) params["buildId"] = ctxBuild.buildId;
    } catch {
      // Non-fatal — fall back to the existing hint / active-build resolution.
    }
  }

  // ─── Runtime kernel-commandment gate (BI-43F95F77) ─────────────────────────
  // Consult the gate BEFORE the switch. If a tier-1 commandment matches this
  // tool name in the active session class, refuse (autonomous) or surface a
  // typed-confirmation requirement (interactive) without ever invoking the
  // tool body. Principle registry is process-cached so this is ~zero-latency
  // after the first dispatch.
  const _sessionClass = detectSessionClass();
  const _principles = await loadEnforceablePrinciples();
  const _decision = evaluateExecution(
    { kind: "mcp_tool", toolName, arguments: params },
    _sessionClass,
    _principles,
  );
  const _slug = _decision.verdict === "allow" ? "_none" : _decision.principleSlug;
  kernelGateDecisionsTotal.inc({
    verdict: _decision.verdict,
    principle_slug: _slug,
    session_class: _sessionClass,
  });
  // CodeQL js/log-injection: toolName + _slug are user-influenced (model
  // submits the tool name; principle slugs derive from wiki frontmatter
  // edited by operators). JSON.stringify each user-influenced value to
  // neutralize CR/LF / control chars — same pattern as
  // neo4j-restore-runner.ts. _decision.verdict and _sessionClass are typed
  // enums and not user-influenced.
  // eslint-disable-next-line no-console
  console.log(
    "[kernel-gate-trace] verdict=%s slug=%s session=%s kind=mcp_tool tool=%s",
    _decision.verdict,
    JSON.stringify(_slug),
    _sessionClass,
    JSON.stringify(toolName),
  );
  if (_decision.verdict === "refuse") {
    return {
      success: false,
      message: `Kernel commandment '${_decision.principleSlug}' refused this tool call.`,
      error: `[kernel-gate] REFUSED by commandment '${_decision.principleSlug}': ${_decision.rationale}`,
      data: {
        kernelGate: {
          verdict: "refuse",
          principleId: _decision.principleId,
          principleSlug: _decision.principleSlug,
          rationale: _decision.rationale,
        },
      },
    };
  }
  if (_decision.verdict === "require_confirm") {
    return {
      success: false,
      message: `Kernel commandment '${_decision.principleSlug}' requires typed confirmation.`,
      error:
        `[kernel-gate] Commandment '${_decision.principleSlug}' requires typed confirmation. ` +
        `Operator must reply with exactly: ${_decision.requiredPhrase}`,
      data: {
        kernelGate: {
          verdict: "require_confirm",
          principleId: _decision.principleId,
          principleSlug: _decision.principleSlug,
          rationale: _decision.rationale,
          requiredPhrase: _decision.requiredPhrase,
        },
      },
    };
  }
  // verdict === "allow" — fall through to the existing switch.

  try {
  // BI-ARCH-TOOLPACKS: tools owned by a scoped pack dispatch through the registry
  // (after the kernel gate above — same gating as any switch case). Packs migrate
  // off the switch one domain at a time.
  const packHandler = TOOL_PACK_REGISTRY.getHandler(toolName);
  if (packHandler) {
    // Match the switch cases exactly: return the handler promise unawaited so
    // its rejection propagates the same way (not swallowed by the try/catch).
    return packHandler(params, userId, context);
  }
  switch (toolName) {
    case "dpf_test_kernel_refuse_probe": {
      // Test-only synthetic probe (Phase 9 live verification).
      // Reachable ONLY when DPF_TEST_MCP_REFUSE_PROBE=1 because:
      //   - loadEnforceablePrinciples injects a synthetic principle that
      //     matches this tool name with refuse-in-both-modes, so the gate
      //     above short-circuits before this body ever runs.
      //   - When the env is unset, no principle matches, but neither does
      //     any production code path call this tool name — we return the
      //     unknown-tool default below.
      // The body exists to give the dispatcher a recognizable case so the
      // gate gets a chance to refuse before falling through to unknown-tool.
      if (process.env.DPF_TEST_MCP_REFUSE_PROBE !== "1") {
        return { success: false, message: "tool not registered", error: "tool not registered" };
      }
      return {
        success: true,
        message: "probe tool body — should not be reached when gate is wired and DPF_TEST_MCP_REFUSE_PROBE=1",
      };
    }
    case "request_coworker": {
      if (!context?.threadId) {
        return { success: false, error: "missing_threadId", message: "request_coworker requires caller thread context." };
      }
      const targetAgent = String(params["targetAgent"] ?? "").trim();
      const objective = String(params["objective"] ?? "").trim();
      if (!targetAgent || !objective) {
        return { success: false, error: "invalid_params", message: "request_coworker requires targetAgent and objective." };
      }
      const tierParam = Number(params["tier"]);
      const enteredViaParam = typeof params["enteredVia"] === "string" ? params["enteredVia"] : undefined;
      const { requestCoworker } = await import("@/lib/tak/coworker-collaboration");
      try {
        const result = await requestCoworker(
          {
            parentThreadId: context.threadId,
            targetAgent,
            objective,
            tier: tierParam === 3 ? 3 : 2,
            enteredVia: enteredViaParam === "escalation" || enteredViaParam === "spawn" ? enteredViaParam : "handoff",
            callerAgentId: context.agentId ?? null,
            questionPacketSummary: typeof params["questionPacketSummary"] === "string" ? params["questionPacketSummary"] : undefined,
            routeContext: context.routeContext,
          },
          userId,
        );
        return {
          success: true,
          entityId: result.childThreadId,
          message: `Handed off to ${result.targetLabel}.`,
          data: result,
        };
      } catch (err) {
        return { success: false, error: "handoff_failed", message: err instanceof Error ? err.message : "request_coworker failed." };
      }
    }
    case "summon_coworker": {
      if (!context?.threadId) {
        return { success: false, error: "missing_threadId", message: "summon_coworker requires caller thread context." };
      }
      const targetAgent = String(params["targetAgent"] ?? "").trim();
      const objective = String(params["objective"] ?? "").trim();
      if (!targetAgent || !objective) {
        return { success: false, error: "invalid_params", message: "summon_coworker requires targetAgent and objective." };
      }
      const tierParam = Number(params["tier"]);
      const { summonCoworker } = await import("@/lib/tak/coworker-collaboration");
      try {
        const result = await summonCoworker(
          {
            parentThreadId: context.threadId,
            targetAgent,
            objective,
            tier: tierParam === 3 ? 3 : 2,
            callerAgentId: context.agentId ?? null,
            routeContext: context.routeContext,
          },
          userId,
        );
        return {
          success: true,
          entityId: result.childThreadId,
          message: `Summoned ${result.targetLabel}.`,
          data: result,
        };
      } catch (err) {
        return { success: false, error: "summon_failed", message: err instanceof Error ? err.message : "summon_coworker failed." };
      }
    }
    case "promote_to_build_studio": {
      const itemId = String(params["itemId"] ?? "");
      const governedConfig = await prisma.platformDevConfig.findUnique({
        where: { id: "singleton" },
        select: { governedBacklogEnabled: true },
      });
      const governedBacklogEnabled = governedConfig?.governedBacklogEnabled === true;

      // WIP cap (shared with the createFeatureBuild start path): refuse to
      // promote another build into Build Studio while too many are unfinished.
      {
        const { wipCapReached, BUILD_WIP_CAP, BuildWipCapError, TERMINAL_BUILD_PHASES } =
          await import("@/lib/build/wip-cap");
        const activeBuilds = await prisma.featureBuild.count({
          where: { phase: { notIn: [...TERMINAL_BUILD_PHASES] }, abandonedAt: null, parentEpicId: null },
        });
        if (wipCapReached(activeBuilds)) {
          const err = new BuildWipCapError(activeBuilds, BUILD_WIP_CAP);
          return { success: false, error: "wip_cap_reached", message: err.message };
        }
      }

      const result = await prisma.$transaction(async (tx) => {
        return promoteBacklogItemToBuildDraft({
          tx,
          itemId,
          userId,
          governedBacklogEnabled,
        });
      });

      if (result.kind === "error") {
        return { success: false, error: result.error, message: result.message };
      }

      // BI-52022707 axis D — auto-dispatch Ideate after governed promotion.
      // The transaction inside promoteBacklogItemToBuildDraft set
      // draftApprovedAt for governed + non-empty-body promotions; that closes
      // the "Record Approve Start" gate but does NOT fire the Ideate research.
      // Mirror the approveBuildStart action's fire-and-forget pattern here so
      // the BS pipeline actually starts work without a second operator click.
      // Fire-and-forget on purpose: the operator's MCP call returns immediately
      // with the FB-* id, and the ~3-min Codex research runs async, exactly
      // like the manual UI button path. Errors are logged + written to
      // BuildActivity by the helper itself — never thrown out here.
      if (result.autoApprovedDispatchEligible) {
        void (async () => {
          try {
            const { dispatchIdeateForApprovedBuild } = await import("@/lib/integrate/ideate-on-approval");
            await dispatchIdeateForApprovedBuild({ buildId: result.build.buildId, userId });
          } catch (err) {
            console.error(
              "[promote_to_build_studio] auto-dispatch Ideate failed (handler swallowed by ideate-on-approval but the dynamic import or top-level invocation rejected):",
              { buildId: result.build.buildId },
              err,
            );
          }
        })();
      }

      return {
        success: true,
        entityId: result.build.buildId,
        message: result.autoApprovedDispatchEligible
          ? `Promoted ${itemId} to Build Studio (auto-approved under governed flow — Ideate research dispatched)`
          : `Promoted ${itemId} to Build Studio`,
        data: {
          buildId: result.build.buildId,
          backlogItemId: itemId,
          autoApprovedDispatchEligible: result.autoApprovedDispatchEligible,
        },
      };
    }

    case "propose_build_decomposition": {
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

    case "approve_decomposition": {
      // Phase 4a (BI-2E6CC391). The candidate is pre-validated by the
      // caller (Phase 4b assistant); we revalidate inside
      // approveDecomposition's pipeline before any DB writes.
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

    case "record_decomposition_override": {
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

    case "create_digital_product": {
      const product = await prisma.digitalProduct.create({
        data: {
          productId: String(params["productId"]),
          name: String(params["name"]),
          lifecycleStage: String(params["lifecycleStage"] ?? "plan"),
          lifecycleStatus: "draft",
        },
      });
      return { success: true, entityId: product.productId, message: `Created product ${product.productId}` };
    }

    case "update_lifecycle": {
      const prod = await prisma.digitalProduct.findUnique({ where: { productId: String(params["productId"]) } });
      if (!prod) return { success: false, error: "Product not found", message: `Product ${String(params["productId"])} not found` };
      const updates: Record<string, unknown> = {};
      if (typeof params["lifecycleStage"] === "string") updates["lifecycleStage"] = params["lifecycleStage"];
      if (typeof params["lifecycleStatus"] === "string") updates["lifecycleStatus"] = params["lifecycleStatus"];
      await prisma.digitalProduct.update({ where: { productId: String(params["productId"]) }, data: updates });
      return { success: true, entityId: String(params["productId"]), message: `Updated lifecycle for ${String(params["productId"])}` };
    }

    case "verify_live_install_readiness": {
      const featureSha = String(params["featureSha"] ?? "").trim();
      if (!featureSha)
        return {
          success: false,
          error: "missing_feature_sha",
          message: "featureSha is required (a PR/BI merge SHA or a build's commit).",
        };
      const { resolveLiveInstallReadiness } = await import("@/lib/verify/preflight-service");
      const verdict = await resolveLiveInstallReadiness({ featureSha });
      return {
        success: true,
        message: `${verdict.verdict}: ${verdict.reason}`,
        data: verdict,
      };
    }

    case "record_execution_evidence": {
      const itemIdRaw = String(params["itemId"] ?? "").trim();
      const kindRaw = String(params["kind"] ?? "");
      const summaryRaw = String(params["summary"] ?? "").slice(0, 240);
      const url = typeof params["url"] === "string" ? params["url"] : null;
      const body = typeof params["body"] === "string" ? params["body"].slice(0, 8000) : null;
      const toolExecutionId =
        typeof params["toolExecutionId"] === "string" ? params["toolExecutionId"] : null;
      const ALLOWED_KINDS = new Set([
        "test_pass",
        "test_fail",
        "build_pass",
        "build_fail",
        "ux_verified",
        "spec_review",
        "manual_check",
        "external_link",
      ]);
      if (!itemIdRaw || !kindRaw || !summaryRaw)
        return {
          success: false,
          error: "missing_required",
          message: "itemId, kind, summary are all required",
        };
      if (!ALLOWED_KINDS.has(kindRaw))
        return { success: false, error: "invalid_kind", message: `kind=${kindRaw} not allowed` };
      const item = await prisma.backlogItem.findUnique({
        where: { itemId: itemIdRaw },
        select: { id: true },
      });
      if (!item)
        return { success: false, error: "not_found", message: `Item ${itemIdRaw} not found` };
      const activity = await prisma.backlogItemActivity.create({
        data: {
          backlogItemId: item.id,
          kind: "evidence",
          summary: summaryRaw,
          payload: {
            evidenceKind: kindRaw,
            url,
            body,
            toolExecutionId,
          },
          recordedById: userId,
          recordedByAgentId: context?.agentId ?? null,
          toolExecutionId,
        },
      });
      return {
        success: true,
        entityId: activity.id,
        message: `Recorded ${kindRaw} evidence for ${itemIdRaw}`,
        data: { activityId: activity.id, recordedAt: activity.recordedAt.toISOString() },
      };
    }

    case "record_external_development_evidence": {
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
      // tracked WorkCapsule, so its work appears in the cross-surface activity view
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
    }

    case "record_local_integration_result": {
      const { recordLocalIntegrationResult } = await import("@/lib/nonprod/local-integration");
      const stringValue = (key: string) => (typeof params[key] === "string" ? String(params[key]).trim() : "");
      const provider = stringValue("provider");
      const externalSessionId = stringValue("externalSessionId");
      const routeContext = stringValue("routeContext") || context?.routeContext || "";
      const candidateBranch = stringValue("candidateBranch");
      const mode = stringValue("mode");
      const status = stringValue("status");
      const summary = stringValue("summary");
      const evidence = params["evidence"];
      const missing = [
        ["provider", provider],
        ["externalSessionId", externalSessionId],
        ["routeContext", routeContext],
        ["candidateBranch", candidateBranch],
        ["mode", mode],
        ["status", status],
        ["summary", summary],
      ].filter(([, value]) => !value).map(([key]) => key);
      if (evidence === undefined) missing.push("evidence");
      if (missing.length > 0) {
        return {
          success: false,
          error: "missing_required",
          message: `Missing required local integration result field(s): ${missing.join(", ")}`,
        };
      }
      if (!["build-studio", "claude", "codex", "coworker"].includes(provider)) {
        return { success: false, error: "invalid_provider", message: `Unsupported provider: ${provider}` };
      }
      if (!["single-branch", "sibling-set", "post-merge-main"].includes(mode)) {
        return { success: false, error: "invalid_mode", message: `Unsupported local integration mode: ${mode}` };
      }
      if (!["passed", "failed", "conflict", "blocked_sandbox_drift"].includes(status)) {
        return { success: false, error: "invalid_status", message: `Unsupported local integration status: ${status}` };
      }

      const result = await recordLocalIntegrationResult({
        actorUserId: userId,
        provider: provider as "build-studio" | "claude" | "codex" | "coworker",
        externalSessionId,
        routeContext,
        buildId: stringValue("buildId") || undefined,
        taskRunId: stringValue("taskRunId") || undefined,
        candidateBranch,
        mode: mode as "single-branch" | "sibling-set" | "post-merge-main",
        status: status as "passed" | "failed" | "conflict" | "blocked_sandbox_drift",
        summary,
        evidence: evidence as import("@dpf/db").Prisma.InputJsonValue,
      });
      return {
        success: true,
        entityId: result.id,
        message: `Recorded local integration result for ${candidateBranch}.`,
        data: { evidenceId: result.id, status },
      };
    }

    case "record_functional_failure_evidence": {
      const required = [
        "testId",
        "suite",
        "route",
        "expected",
        "actual",
        "userRole",
        "routeContext",
        "reproCommand",
        "createdAt",
        "likelyOwnerArea",
      ];
      const missing = required.filter((key) => typeof params[key] !== "string" || !String(params[key]).trim());
      if (missing.length > 0) {
        return {
          success: false,
          error: "missing_required",
          message: `Missing required functional failure evidence field(s): ${missing.join(", ")}`,
        };
      }

      const testId = String(params["testId"]).trim();
      const suite = String(params["suite"]).trim();
      const route = String(params["route"]).trim();
      const expected = redactFunctionalFailureText(String(params["expected"]));
      const actual = redactFunctionalFailureText(String(params["actual"]));
      const userRole = String(params["userRole"]).trim();
      const routeContext = String(params["routeContext"]).trim();
      const reproCommand = String(params["reproCommand"]).trim();
      const createdAt = String(params["createdAt"]).trim();
      const likelyOwnerArea = String(params["likelyOwnerArea"]).trim();
      const agentId = typeof params["agentId"] === "string" ? params["agentId"].trim() || null : null;
      const screenshotPath =
        typeof params["screenshotPath"] === "string" ? params["screenshotPath"].trim() || null : null;
      const tracePath = typeof params["tracePath"] === "string" ? params["tracePath"].trim() || null : null;
      const buildId = typeof params["buildId"] === "string" ? params["buildId"].trim() || null : null;
      const explicitItemId =
        typeof params["backlogItemId"] === "string" ? params["backlogItemId"].trim() || null : null;

      const normalizedActual = actual.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 1200);
      const failureFingerprint = crypto
        .createHash("sha256")
        .update(`${testId}|${route}|${normalizedActual}`)
        .digest("hex")
        .slice(0, 16);

      const evidencePayload = {
        evidenceKind: "test_fail",
        source: "functional-test-failure",
        failureFingerprint,
        testId,
        suite,
        route,
        expected,
        actual,
        screenshotPath,
        tracePath,
        userRole,
        agentId,
        routeContext,
        reproCommand,
        createdAt,
        likelyOwnerArea,
        buildId,
      };
      const summary = `${testId} failed${route ? ` on ${route}` : ""}: ${actual.slice(0, 120)}`;

      let item = explicitItemId
        ? await prisma.backlogItem.findUnique({
            where: { itemId: explicitItemId },
            select: { id: true, itemId: true, occurrenceCount: true },
          })
        : null;

      if (!item) {
        item = await prisma.backlogItem.findFirst({
          where: {
            source: "functional-test-failure",
            status: { notIn: ["done", "deferred"] },
            body: { contains: `failureFingerprint: ${failureFingerprint}` },
          },
          select: { id: true, itemId: true, occurrenceCount: true },
        });
      }

      let action: "created" | "updated";
      if (!item) {
        item = await prisma.backlogItem.create({
          data: {
            itemId: `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
            title: `[${testId}] ${route} functional smoke failure`,
            type: "product",
            status: "triaging",
            source: "functional-test-failure",
            submittedById: userId,
            agentId: context?.agentId ?? agentId ?? null,
            lastSeenAt: new Date(createdAt),
            body: [
              `failureFingerprint: ${failureFingerprint}`,
              `ownerArea: ${likelyOwnerArea}`,
              `route: ${route}`,
              `suite: ${suite}`,
              `expected: ${expected}`,
              `actual: ${actual}`,
              `repro: ${reproCommand}`,
            ].join("\n"),
          },
          select: { id: true, itemId: true, occurrenceCount: true },
        });
        action = "created";
      } else {
        item = await prisma.backlogItem.update({
          where: { id: item.id },
          data: {
            occurrenceCount: { increment: 1 },
            lastSeenAt: new Date(createdAt),
          },
          select: { id: true, itemId: true, occurrenceCount: true },
        });
        action = "updated";
      }

      const activity = await prisma.backlogItemActivity.create({
        data: {
          backlogItemId: item.id,
          kind: "evidence",
          summary: action === "created" ? summary.slice(0, 240) : `${testId} failed again on ${route}`.slice(0, 240),
          payload: evidencePayload,
          recordedById: userId,
          recordedByAgentId: context?.agentId ?? agentId ?? null,
        },
      });

      return {
        success: true,
        entityId: item.itemId,
        message:
          action === "created"
            ? `Created ${item.itemId} for ${testId} functional failure`
            : `Updated ${item.itemId} with repeated ${testId} functional failure`,
        data: {
          action,
          itemId: item.itemId,
          activityId: activity.id,
          failureFingerprint,
          occurrenceCount: item.occurrenceCount,
          recordedAt: activity.recordedAt.toISOString(),
        },
      };
    }

    case "drive_browser_task": {
      // Dynamic import: drive → select-means → mcp-tools forms a static cycle;
      // importing here breaks it (same pattern as agent-grants / mcp-server-tools).
      const { driveBrowserTask } = await import("./browser-drive/drive");
      const { isDestructiveBrowserAction } = await import("./browser-drive/envelope");
      const outward = String(params["outwardAction"] ?? "");
      const result = await driveBrowserTask({
        task: String(params["task"] ?? ""),
        siteKey: String(params["siteKey"] ?? ""),
        accountKey: typeof params["accountKey"] === "string" ? (params["accountKey"] as string) : undefined,
        targetDomains: Array.isArray(params["targetDomains"]) ? (params["targetDomains"] as unknown[]).map(String) : [],
        targetUrl: typeof params["targetUrl"] === "string" ? (params["targetUrl"] as string) : undefined,
        kind: params["kind"] === "read" ? "read" : "act",
        mode: params["mode"] === "operator-live" ? "operator-live" : "service-account",
        outwardAction: isDestructiveBrowserAction(outward) ? outward : undefined,
        renderedArtifact: params["renderedArtifact"],
        rationale: typeof params["rationale"] === "string" ? (params["rationale"] as string) : undefined,
        agentId: context?.agentId?.trim() || "coworker",
        threadId: context?.threadId?.trim() || "",
        userId,
      });
      const messages: Record<string, string> = {
        completed: "Browser task completed.",
        "awaiting-approval": "Rendered the action for your approval — it will run once you approve the envelope.",
        "needs-provisioning": `No service-account profile for "${String(params["siteKey"] ?? "")}" yet. Set one up in Service Account Browser Setup.`,
        "needs-human": "The means selector wasn't confident — needs a human decision.",
        blocked: "Blocked.",
        error: "Browser task failed.",
      };
      return {
        success: result.status === "completed" || result.status === "awaiting-approval",
        message: messages[result.status] ?? result.status,
        data: result,
      };
    }

    case "update_feature_brief": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
      const { updateFeatureBrief } = await import("@/lib/actions/build");
      // Merge OVER the existing brief. updateFeatureBrief persists the whole
      // brief object, so rebuilding it from scratch would clobber any field the
      // caller omits — notably fixContext, which the fix-flow ideate phase fills
      // incrementally. A fix build is also promoted with title/description
      // pre-seeded; without this merge a fixContext-only update would blank them
      // and fail validateFeatureBrief.
      const prior = (await prisma.featureBuild.findUnique({
        where: { buildId },
        select: { brief: true },
      }))?.brief as Partial<import("@/lib/feature-build-types").FeatureBrief> | null;
      const str = (key: string, fallback: string) =>
        params[key] != null ? String(params[key]) : fallback;
      const arr = (key: string, fallback: string[]) =>
        Array.isArray(params[key]) ? (params[key] as unknown[]).map(String) : fallback;
      const incomingFix = params["fixContext"] && typeof params["fixContext"] === "object" && !Array.isArray(params["fixContext"])
        ? (params["fixContext"] as Record<string, unknown>)
        : null;
      const mergedFix = (prior?.fixContext || incomingFix)
        ? { ...(prior?.fixContext ?? {}), ...(incomingFix ?? {}) }
        : undefined;
      const brief = {
        title: str("title", prior?.title ?? ""),
        description: str("description", prior?.description ?? ""),
        portfolioContext: str("portfolioContext", prior?.portfolioContext ?? ""),
        targetRoles: arr("targetRoles", prior?.targetRoles ?? []),
        inputs: arr("inputs", prior?.inputs ?? []),
        dataNeeds: str("dataNeeds", prior?.dataNeeds ?? ""),
        acceptanceCriteria: arr("acceptanceCriteria", prior?.acceptanceCriteria ?? []),
        ...(mergedFix ? { fixContext: mergedFix } : {}),
      };
      try {
        await updateFeatureBrief(buildId, brief as import("@/lib/feature-build-types").FeatureBrief);
        await updateBuildHappyPathState(userId, {
          intake: {
            constrainedGoal: brief.title || null,
          },
        }, buildId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Update failed";
        return { success: false, error: msg, message: `Could not update brief: ${msg}. The brief can only be updated during the Ideate phase. You are past that phase — proceed with your current phase instead.` };
      }
      return { success: true, entityId: buildId, message: `Updated Feature Brief for ${buildId}` };
    }

    case "register_digital_product_from_build": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
      // Pre-flight: deploy_feature must have run first to extract the diff.
      const diffCheck = await prisma.featureBuild.findUnique({
        where: { buildId },
        select: { diffPatch: true },
      });
      if (!diffCheck?.diffPatch) {
        return {
          success: false,
          error: "deploy_feature must be called first",
          message: "The sandbox diff has not been extracted yet. Call deploy_feature first to extract the diff, then call register_digital_product_from_build.",
        };
      }
      const { shipBuild } = await import("@/lib/actions/build");
      try {
        const result = await shipBuild({
          buildId,
          name: String(params["name"]),
          portfolioSlug: String(params["portfolioSlug"]),
          versionBump: (params["versionBump"] as "major" | "minor" | "patch") ?? "minor",
          // Thread the MCP actor through so this works in a session-less context
          // (autonomous ship from the reconciler). UI callers go through the
          // session as before; shipBuild falls back to requireBuildAccess().
          actorUserId: userId,
        });
        return {
          success: true,
          entityId: result.productId,
          message: result.message,
          data: {
            productInternalId: result.productInternalId,
            portfolioInternalId: result.portfolioInternalId,
            promotionId: result.promotionId,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Ship failed";
        return { success: false, error: msg, message: `Product registration failed: ${msg}` };
      }
    }

    case "create_build_epic": {
      const epicBuildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!epicBuildId) return { success: false, error: "No active build", message: "No active build found" };
      // Auto-resolve digitalProductId and portfolioSlug from the build's linked product
      const epicBuild = await prisma.featureBuild.findUnique({
        where: { buildId: epicBuildId },
        select: {
          digitalProductId: true,
          portfolioId: true,
          digitalProduct: { select: { portfolio: { select: { slug: true } } } },
        },
      });
      const resolvedProductId = epicBuild?.digitalProductId ?? undefined;
      const resolvedPortfolioSlug = typeof params["portfolioSlug"] === "string"
        ? params["portfolioSlug"]
        : epicBuild?.digitalProduct?.portfolio?.slug ?? undefined;

      const { createBuildEpic } = await import("@/lib/actions/build");
      const epicInput: { buildId: string; title: string; portfolioSlug?: string; digitalProductId?: string } = {
        buildId: epicBuildId,
        title: String(params["title"]),
      };
      if (resolvedPortfolioSlug) epicInput.portfolioSlug = resolvedPortfolioSlug;
      if (resolvedProductId) epicInput.digitalProductId = resolvedProductId;
      try {
        const result = await createBuildEpic(epicInput);
        await updateBuildHappyPathState(userId, {
          intake: {
            epicId: result.epicId,
          },
        }, epicBuildId);
        return { success: true, entityId: result.epicId, message: result.message };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Epic creation failed";
        return { success: false, error: msg, message: `Could not create epic: ${msg}` };
      }
    }

    case "assess_complexity": {
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

    case "propose_decomposition": {
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

    case "save_build_notes": {
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
    }

    case "save_phase_handoff": {
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
        const { checkPhaseGate, canTransitionPhase, normalizeHappyPathState } = await import("@/lib/feature-build-types");
        if (canTransitionPhase(latestBuild.phase as import("@/lib/feature-build-types").BuildPhase, toPhase as import("@/lib/feature-build-types").BuildPhase)) {
          const plan = (latestBuild.plan as Record<string, unknown> | null) ?? {};
          const happyPathState = normalizeHappyPathState(plan.happyPathState);
          const handoffBrief = latestBuild.brief as { acceptanceCriteria?: string[]; fixContext?: import("@/lib/feature-build-types").FixContext } | null;
          const gate = checkPhaseGate(
            latestBuild.phase as import("@/lib/feature-build-types").BuildPhase,
            toPhase as import("@/lib/feature-build-types").BuildPhase,
            {
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
          );
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
            await prisma.featureBuild.update({ where: { buildId: latestBuild.buildId }, data: { phase: toPhase } });
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
    }

    case "get_build_progress_visibility": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
      const { getBuildProgressVisibility } = await import("@/lib/build/progress-visibility");
      const projection = await getBuildProgressVisibility(buildId);
      if (!projection) return { success: false, error: "Build not found", message: `Build ${buildId} was not found.` };
      return {
        success: true,
        entityId: buildId,
        message: `Build progress visibility loaded for ${buildId}: ${projection.progress.primary.completed}/${projection.progress.primary.total} tasks from ${projection.progress.primary.source}.`,
        data: projection as unknown as Record<string, unknown>,
      };
    }

    case "verification_preflight": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
      const build = await prisma.featureBuild.findUnique({
        where: { buildId },
        select: { phase: true, acceptanceMet: true, verificationOut: true, buildExecState: true },
      });
      if (!build) return { success: false, error: "Build not found", message: `Build ${buildId} was not found.` };
      const { verificationPreflight, gatherPreflightSignals, preflightDirective } = await import(
        "@/lib/build/verification-preflight"
      );
      // The portal serving this tool is up (installHealthy) and its DB is reachable
      // (this row just loaded). Sandbox/quiescence probes are a follow-up refinement;
      // for now they default healthy so the verdict turns on evidence + artifact.
      const signals = gatherPreflightSignals(build, {
        installHealthy: true,
        requiredServicesHealthy: true,
        explicitBlocker: null,
      });
      const result = verificationPreflight(signals);
      return {
        success: true,
        entityId: buildId,
        message: preflightDirective(result),
        data: { verdict: result.verdict, reason: result.reason, blocker: result.blocker },
      };
    }

    case "get_build_sandbox_state": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
      const { getSandboxStateForBuild } = await import("@/lib/build/sandbox-state");
      const state = await getSandboxStateForBuild(buildId);
      if (!state) return { success: false, error: "Build not found", message: `Build ${buildId} was not found.` };
      return {
        success: true,
        entityId: buildId,
        message: `Sandbox state loaded for ${buildId}: branch ${state.branch ?? "unknown"}, ${state.sourceDiffstat.length} source file(s) changed.`,
        data: state as unknown as Record<string, unknown>,
      };
    }

    case "get_build_dispatch_history": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
      const { getDispatchHistoryForBuild } = await import("@/lib/build/dispatch-attempts");
      const history = await getDispatchHistoryForBuild(buildId);
      return {
        success: true,
        entityId: buildId,
        message: `Dispatch history loaded for ${buildId}: ${history.length} attempt(s).`,
        data: { buildId, attempts: history },
      };
    }

    case "get_build_scoped_verification": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
      const { getScopedVerificationForBuild } = await import("@/lib/build/scoped-verification");
      const verification = await getScopedVerificationForBuild(buildId);
      if (!verification) return { success: false, error: "Build not found", message: `Build ${buildId} was not found.` };
      return {
        success: true,
        entityId: buildId,
        message: `Scoped verification loaded for ${buildId}: ${verification.buildScoped.failureAxis ?? "no failure"} axis.`,
        data: verification as unknown as Record<string, unknown>,
      };
    }

    case "list_build_activity_since": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
      const cursor = typeof params["cursor"] === "string" && params["cursor"].trim()
        ? new Date(params["cursor"])
        : null;
      if (cursor != null && !Number.isFinite(cursor.getTime())) {
        return { success: false, error: "Invalid cursor", message: "cursor must be an ISO timestamp when provided." };
      }
      const activities = await prisma.buildActivity.findMany({
        where: {
          buildId,
          ...(cursor ? { createdAt: { gt: cursor } } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: 50,
        select: { id: true, buildId: true, tool: true, summary: true, createdAt: true },
      });
      const rows = activities.map((activity) => ({
        ...activity,
        createdAt: activity.createdAt.toISOString(),
      }));
      return {
        success: true,
        entityId: buildId,
        message: `Loaded ${rows.length} build activit${rows.length === 1 ? "y" : "ies"} for ${buildId}.`,
        data: {
          buildId,
          activities: rows,
          nextCursor: rows.at(-1)?.createdAt ?? params["cursor"] ?? null,
        },
      };
    }

    // ─── Build Studio Lifecycle Tool Handlers (EP-SELF-DEV-002) ─────────────

    case "saveBuildEvidence": {
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
          plan = plan.buildPlan as Record<string, unknown>;
          normalizedValue = plan;
        }
        const fileStructure = plan?.fileStructure;
        const tasks = plan?.tasks;

        if (!plan || typeof plan !== "object") {
          return { success: false, error: "buildPlan must be a JSON object.", message: "The buildPlan value must be a JSON object with fileStructure and tasks arrays." };
        }

        if (!Array.isArray(fileStructure) || fileStructure.length === 0) {
          const hint = plan ? `Got keys: ${Object.keys(plan).join(", ")}` : "Got null";
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
      await saveBuildArtifactRevision({
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
    }

    case "reviewDesignDoc": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      let phaseGateBlocker: string | null = null;
      // Right-sizing matrix: also select plan (carries processSize) so the
      // fix-flow gate picks the (fix, small | medium | large | xlarge) cell
      // rather than always falling back to (fix, medium). plan is also
      // needed below for the standard feature path's intake fallback.
      // BI-CE49D82E — also select prior designReview so we can pass its issues
      // to the reviewer prompt for delta-awareness and surface the iteration
      // trajectory in the operator-facing gate reason (mirror of BI-4396EFEC
      // for the plan path). Live repro: FB-5E20E793 oscillated on the same
      // "missing accessibility" complaint round after round.
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { designDoc: true, designReview: true, kind: true, brief: true, plan: true } });

      // Fix flow: a fix build has no feature design doc — it carries a structured
      // diagnosis (fixContext) on its brief. Review the diagnosis for completeness
      // and advance ideate → plan, instead of running the feature design reviewers.
      if (build?.kind === "fix") {
        const { isFixContextComplete, checkPhaseGate } = await import("@/lib/feature-build-types");
        const fixBrief = (build.brief ?? null) as import("@/lib/feature-build-types").FeatureBrief | null;
        const fixProcessSize = ((build.plan as Record<string, unknown> | null)?.processSize as string | undefined) ?? "medium";
        const fc = fixBrief?.fixContext;
        const complete = isFixContextComplete(fc);
        const review = complete
          ? { decision: "pass" as const, issues: [] as Array<{ severity: string; description: string }>, summary: "Fix diagnosis is complete: reproduction, root cause, and fix approach are all present." }
          : { decision: "fail" as const, issues: [{ severity: "critical", description: "Fix diagnosis is incomplete. Reproduction steps, root cause, and fix approach are all required — use update_feature_brief to fill fixContext." }], summary: "Incomplete fix diagnosis." };
        await prisma.featureBuild.update({ where: { buildId }, data: { designReview: review as unknown as import("@dpf/db").Prisma.InputJsonValue } });
        const { agentEventBus } = await import("@/lib/agent-event-bus");
        if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "designReview" });
        logBuildActivity(buildId, "reviewDesignDoc", `Fix review: ${review.decision}. ${review.summary}`);
        if (review.decision === "fail") {
          await triggerDesignReviewAutoRepair(buildId, userId, context);
          return { success: true, message: `Fix review FAILED. ${review.issues[0]?.description ?? review.summary}`, data: { review, blocked: true, action: "revise_and_resubmit" } };
        }
        let fixPhaseGateBlocker: string | null = null;
        try {
          const gate = checkPhaseGate("ideate", "plan", { kind: "fix", processSize: fixProcessSize, fixContext: fc, designReview: review });
          if (gate.allowed) {
            const { completeBuildPhaseRun, startBuildPhaseRun } = await import("@/lib/integrate/build-phase-run");
            void completeBuildPhaseRun(buildId, "ideate");
            void startBuildPhaseRun(buildId, "plan").catch(() => {}); // swallow QuiescingError thrown during a self-upgrade drain (BI-QUIESCE-005)
            if (context?.threadId) {
              const { persistPhaseHandoffSummary } = await import("@/lib/integrate/phase-compaction-wire");
              void persistPhaseHandoffSummary(context.threadId, "ideate");
            }
            await prisma.featureBuild.update({ where: { buildId }, data: { phase: "plan" } });
            if (context?.threadId) agentEventBus.emit(context.threadId, { type: "phase:change", buildId, phase: "plan" });
            logBuildActivity(buildId, "phase:advance", "Phase advanced: ideate → plan (fix)");
          } else {
            logBuildActivity(buildId, "phase:gate-blocked", gate.reason ?? "unknown");
            fixPhaseGateBlocker = gate.reason ?? null;
          }
        } catch (err) {
          console.error("[reviewDesignDoc:fix] auto-advance failed:", err);
        }
        const fixMsg = fixPhaseGateBlocker
          ? `Fix review: ${review.decision}. ${review.summary}\n\nPhase did NOT advance to plan. Reason: ${fixPhaseGateBlocker}`
          : `Fix review: ${review.decision}. ${review.summary} Phase advanced to plan.`;
        return { success: true, message: fixMsg, data: { review, phaseGateBlocker: fixPhaseGateBlocker } };
      }

      if (!build?.designDoc) return { success: false, error: "No design document saved yet.", message: "Save designDoc first." };
      const { buildDesignReviewPrompt, buildArchitectureReviewPrompt, finalizeArchitectureAdvisory, parseReviewResponse, mergeReviews, collectReviewerVerdicts } = await import("@/lib/build-reviewers");
      const designDocTyped = build.designDoc as Parameters<typeof buildDesignReviewPrompt>[0];
      // BI-CE49D82E — Compute the iteration context up front so we can
      // (a) feed prior issues into the reviewer prompt and (b) populate
      // ReviewResult.iteration on the output. Round is 1-based: first
      // review = 1, every subsequent reviewDesignDoc call increments.
      const priorDesignReview = (build.designReview ?? null) as
        | { issues?: Array<{ severity?: string; description?: string }>; iteration?: { round?: number } }
        | null;
      const priorRound = priorDesignReview?.iteration?.round ?? 0;
      const priorIssues = Array.isArray(priorDesignReview?.issues)
        ? priorDesignReview!.issues!
            .filter((i): i is { severity: string; description: string } =>
              typeof i?.severity === "string" && typeof i?.description === "string",
            )
            .map((i) => ({ severity: i.severity, description: i.description }))
        : [];
      const currentRound = priorRound + 1;
      const priorContext = priorIssues.length > 0
        ? { round: priorRound, issues: priorIssues }
        : null;
      const prompt = buildDesignReviewPrompt(designDocTyped, "", priorContext);
      const archPrompt = buildArchitectureReviewPrompt({ kind: "design", doc: designDocTyped }, "");
      const { routeAndCall } = await import("@/lib/routed-inference");
      const messages = [{ role: "user" as const, content: prompt }];
      // Run the two checklist reviewers PLUS the advisory architecture reviewer
      // (chief-architect / Enterprise Architect lens) in parallel. The
      // architecture reviewer NEVER enters mergeReviews — it is advisory only:
      // it joins the deliberation trail as the `architect` branch and rides
      // along on review.architectureAdvisory so the coworker can fold concerns
      // into the spec, but it cannot gate pass/fail.
      const [r1settled, r2settled, archSettled] = await Promise.allSettled([
        routeAndCall(messages, "You are a design reviewer.", "internal"),
        routeAndCall(
          messages,
          "You are an independent design reviewer. Focus especially on security, data integrity, edge cases, and accessibility gaps the primary reviewer may have missed.",
          "internal",
          { budgetClass: "minimize_cost" },
        ),
        routeAndCall(
          [{ role: "user" as const, content: archPrompt }],
          "You are the Enterprise Architect (DPF chief-architect lens) reviewing for architectural alignment. Advisory only — surface concerns and concrete spec edits, never block the gate.",
          "internal",
          { budgetClass: "minimize_cost" },
        ),
      ]);
      const r1 = r1settled.status === "fulfilled" ? parseReviewResponse(r1settled.value.content) : null;
      const r2 = r2settled.status === "fulfilled" ? parseReviewResponse(r2settled.value.content) : null;
      const archReview = archSettled.status === "fulfilled" ? parseReviewResponse(archSettled.value.content) : null;
      const architectureAdvisory = await finalizeArchitectureAdvisory(prisma, archReview, userId, context?.agentId, context?.threadId, "reviewDesignDoc");
      const reviewBase = r1 && r2 ? mergeReviews(r1, r2) : r1 ?? r2 ?? {
        decision: "fail" as const,
        issues: [{ severity: "critical" as const, description: "Both review agents failed to respond" }],
        summary: "Review could not be completed — retry.",
      };
      // BI-CE49D82E — Compute the iteration delta against the prior round and
      // attach to the ReviewResult. computeReviewDelta + isOscillating live in
      // feature-build-types so they're independently unit-testable and shared
      // with the plan path.
      const { computeReviewDelta, isOscillating } = await import("@/lib/feature-build-types");
      const reviewWithIteration = (() => {
        if (priorIssues.length === 0) {
          return { ...reviewBase, iteration: { round: currentRound } };
        }
        const delta = computeReviewDelta(priorIssues, reviewBase.issues);
        return {
          ...reviewBase,
          iteration: {
            round: currentRound,
            prior: delta,
            oscillating: isOscillating(delta, reviewBase.issues.length),
          },
        };
      })();
      const review = architectureAdvisory ? { ...reviewWithIteration, architectureAdvisory } : reviewWithIteration;
      const archAdvisoryNote = architectureAdvisory && architectureAdvisory.issues.length > 0
        ? ` Architecture review (advisory): ${architectureAdvisory.summary} Fold actionable items into the design before building — they do not block this gate.`
        : "";

      // Phase 2 of design-time decomposition (BI-2E6CC391, spec
      // docs/superpowers/specs/2026-05-24-build-studio-design-time-
      // decomposition-design.md). Run the deterministic sizing counter and
      // record the assessment alongside the review. Informational only —
      // no gate, no UX change. Surfaces the rationale ("5 models, 25 ACs,
      // 4 multipliers → required") so when Phase 3's gate ships, operators
      // have already seen the signal in passing.
      const { sizeDesignDoc } = await import("@/lib/build/size-design-doc");
      const sizeAssessment = sizeDesignDoc(build.designDoc as Parameters<typeof sizeDesignDoc>[0]);
      // Preserve the individual reviewer verdicts (pre-merge) so the Review-phase
      // UI can show which named reviewer cleared vs flagged. Nested on the JSON
      // column — no migration. Same r1/r2/archReview the deliberation trail uses.
      const reviewers = collectReviewerVerdicts(r1, r2, archReview);
      // Preserve an operator decomposition override across review re-runs.
      // record_decomposition_override writes designReview.decompositionOverride; the
      // Phase-4b gate below (and resume-pre-build-phase) reads it to let an overridden
      // build advance past decompose-required. Re-attach it here — otherwise this write
      // replaces designReview and wipes the override, the gate sees !hasOverride, and the
      // build re-parks at the decompose gate forever (the override→advance path, incl.
      // resume re-running reviewDesignDoc, never completes).
      const priorOverride =
        (build.designReview as { decompositionOverride?: unknown } | null)?.decompositionOverride ?? null;
      const reviewWithSize = {
        ...review,
        sizeAssessment,
        ...(reviewers.length > 0 ? { reviewers } : {}),
        ...(priorOverride != null ? { decompositionOverride: priorOverride } : {}),
      };
      await prisma.featureBuild.update({ where: { buildId }, data: { designReview: reviewWithSize as unknown as import("@dpf/db").Prisma.InputJsonValue } });
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "designReview" });
      logBuildActivity(buildId, "reviewDesignDoc", `Design review: ${review.decision}. ${review.summary}`);
      logBuildActivity(
        buildId,
        "design-size-assessed",
        `Design size: ${sizeAssessment.decision}. ${sizeAssessment.rationale}`,
      );

      // Record a deliberation trail for this dual-reviewer run. The review
      // result above still gates pass/fail; this layer is the honest
      // retrospective the Deliberation Pattern Framework persists for UI +
      // audit (spec §7). Wrap in try/catch — a deliberation write MUST NOT
      // break the review gate (fail-loud via console.warn per project memory
      // "silent seed skips audit").
      try {
        const reviewerBranches: ReviewBranchInput[] = [];
        if (r1) reviewerBranches.push({ branchNodeId: "reviewer-1", role: "reviewer", review: r1 });
        if (r2) reviewerBranches.push({ branchNodeId: "reviewer-2", role: "reviewer", review: r2 });
        // Advisory architecture branch — its objections become unresolved
        // risks in the deliberation summary but never flip the gate.
        if (archReview) reviewerBranches.push({ branchNodeId: "architect", role: "architect", review: archReview });
        if (reviewerBranches.length > 0) {
          const { runBuildReviewDeliberation } = await import("@/lib/integrate/build-orchestrator");
          await runBuildReviewDeliberation({
            userId,
            buildId,
            phase: "ideate",
            reviewerBranches,
            ...(context?.threadId ? { threadId: context.threadId } : {}),
          });
        }
      } catch (err) {
        console.warn("[deliberation] failed to record build review trail: %s",
          err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)));
      }

      // Failed review → structured recovery instructions, no auto-advance
      if (review.decision === "fail") {
        await triggerDesignReviewAutoRepair(buildId, userId, context);
        const criticalIssues = review.issues.filter((i: { severity: string }) => i.severity === "critical");
        const issueList = criticalIssues.length > 0
          ? criticalIssues.map((i: { description: string }) => i.description).join("; ")
          : review.summary;
        // BI-CE49D82E — Include the iteration trajectory in the agent-facing
        // message so the implementer model sees when its revisions are trading
        // one set of issues for another instead of converging. The oscillating
        // signal recommends a scope split rather than another iteration —
        // matching the plan path established by BI-4396EFEC (D38).
        const iter = review.iteration;
        const trajectoryNote = iter?.prior
          ? ` (Round ${iter.round}: ${iter.prior.addressed} addressed, ${iter.prior.persisted} persist, ${iter.prior.newlySurfaced} new${iter.oscillating ? " — issues are not net-decreasing across rounds; consider proposing a scope split rather than another revision." : ""}.)`
          : "";
        return {
          success: true,
          message: `Design review FAILED. Blocking issues: ${issueList}. Revise the design document to address these issues, then call saveBuildEvidence with field "designDoc" and re-run reviewDesignDoc.${trajectoryNote}${archAdvisoryNote}`,
          data: { review, blocked: true, action: "revise_and_resubmit" },
        };
      }

      // Passed review → auto-complete intake anchors the user didn't
      // explicitly set, then try to advance the phase.
      //
      // Before: only designDoc + designReview were passed to checkPhaseGate,
      // which evaluates evidence.happyPathState too and silently failed on
      // null (default-all-null from normalizeHappyPathState). Phase stayed
      // ideate forever, the coworker kept saying "Ready to move to planning?"
      // and nothing moved. Observed by Mark 2026-04-20 on the subnet-filter
      // graph build.
      //
      // Fix:
      //   1. Read plan from DB so we have the real happyPathState.
      //   2. If backlogItemId or epicId are null (user didn't manually
      //      create them), auto-create them here. constrainedGoal and
      //      taxonomyNodeId are normally populated by update_feature_brief
      //      and confirm_taxonomy_placement which the agent already calls
      //      in the ideate loop.
      //   3. Pass happyPathState to checkPhaseGate so the full intake
      //      check actually runs.
      try {
        const { checkPhaseGate, canTransitionPhase, normalizeHappyPathState, deriveIntakeTaxonomyAnchor } = await import("@/lib/feature-build-types");
        const updatedBuild = await prisma.featureBuild.findUnique({
          where: { buildId },
          select: {
            phase: true,
            // Right-sizing matrix: kind drives policy selection in
            // checkPhaseGate; pre-existing rows default to "feature" via
            // the schema default, so this is back-compat-safe.
            kind: true,
            originatingBacklogItemId: true,
            draftApprovedAt: true,
            designDoc: true,
            designReview: true,
            plan: true,
            title: true,
            description: true,
            digitalProductId: true,
            digitalProduct: { select: { portfolio: { select: { slug: true } } } },
          },
        });

        if (updatedBuild && updatedBuild.phase === "ideate" && canTransitionPhase("ideate", "plan")) {
          const governedConfig = await prisma.platformDevConfig.findUnique({
            where: { id: "singleton" },
            select: { governedBacklogEnabled: true },
          });
          const requiresStartApproval =
            updatedBuild.originatingBacklogItemId != null
            && updatedBuild.draftApprovedAt == null;

          if (requiresStartApproval) {
            logBuildActivity(buildId, "phase:gate-blocked", "Approve Start is required before ideate can advance to plan.");
            return {
              success: true,
              message: `Design review: ${review.decision}. ${review.summary} This governed backlog draft is prepared and now waiting for Approve Start before planning can begin.`,
              data: { review, blocked: true, action: "approve_start" },
            };
          }

          // Phase 4b decompose-required gate (BI-2E6CC391). If the build's
          // size assessment is "decompose-required" AND no decomposition
          // happened (build still exists in ideate, not superseded) AND no
          // operator override was recorded, refuse advance and tell the
          // operator what to do next. Recommended-tier and ok-tier builds
          // proceed through to plan unchanged.
          const sizedReview = (updatedBuild.designReview ?? null) as
            | { sizeAssessment?: { decision?: string }; decompositionOverride?: unknown }
            | null;
          const decomposeDecision = sizedReview?.sizeAssessment?.decision ?? null;
          const hasOverride = sizedReview?.decompositionOverride != null;
          if (decomposeDecision === "decompose-required" && !hasOverride) {
            logBuildActivity(
              buildId,
              "phase:gate-blocked",
              "decompose-required gate fired; advance blocked until decomposition or override.",
            );
            return {
              success: true,
              message: `Design review: ${review.decision}, but the size assessment is decompose-required. Before advancing to Plan, either call approve_decomposition with a chosen DecompositionCandidate (preferred) — see propose_decomposition to generate candidates — OR call record_decomposition_override with a one-line justification to ship monolithically.`,
              data: { review, blocked: true, action: "decompose_or_override" },
            };
          }

          const plan = (updatedBuild.plan as Record<string, unknown> | null) ?? {};
          let happyPathState = normalizeHappyPathState(plan.happyPathState);

          // Auto-create epic if missing via the request-scope-INDEPENDENT
          // autoCreateBuildEpic helper (NOT the createBuildEpic server action,
          // whose headers() throws on autonomous resume — see auto-intake-epic.ts).
          if (!happyPathState.intake.epicId) {
            try {
              const { autoCreateBuildEpic } = await import("@/lib/integrate/auto-intake-epic");
              const epicTitle = updatedBuild.title || happyPathState.intake.constrainedGoal || "Build Studio feature";
              const createdEpic = await autoCreateBuildEpic({
                db: prisma,
                title: epicTitle,
                portfolioSlug: updatedBuild.digitalProduct?.portfolio?.slug ?? null,
              });
              await updateBuildHappyPathState(userId, {
                intake: { epicId: createdEpic.epicId },
              }, buildId);
              happyPathState = { ...happyPathState, intake: { ...happyPathState.intake, epicId: createdEpic.epicId } };
              logBuildActivity(buildId, "auto-intake:epic", `Auto-created epic ${createdEpic.epicId} (${epicTitle})`);
            } catch (err) {
              console.warn("[reviewDesignDoc] auto-create epic failed:", err);
            }
          }

          // Auto-create backlog item if missing.
          if (!happyPathState.intake.backlogItemId) {
            try {
              const itemId = `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
              const title = updatedBuild.title || happyPathState.intake.constrainedGoal || "Build Studio feature";
              const body = String(updatedBuild.description ?? "").slice(0, 2000);

              // BacklogItem.epicId is the FK to Epic.id (cuid), NOT the
              // semantic "EP-BUILD-xxx" string. happyPathState stores the
              // semantic id, so we must resolve it to the cuid before
              // passing it as a FK — otherwise the FK check fails with
              // BacklogItem_epicId_fkey and the auto-create swallows silently
              // (observed 2026-04-20 on FB-21EEA510: epic linked, backlog
              // stuck null, phase gate blocked forever).
              let epicCuid: string | null = null;
              if (happyPathState.intake.epicId) {
                const epicRow = await prisma.epic.findUnique({
                  where: { epicId: happyPathState.intake.epicId },
                  select: { id: true },
                });
                epicCuid = epicRow?.id ?? null;
              }

              await prisma.backlogItem.create({
                data: {
                  itemId,
                  title,
                  type: "product",
                  status: "in-progress",
                  submittedById: userId,
                  ...(body ? { body } : {}),
                  ...(epicCuid ? { epicId: epicCuid } : {}),
                },
              });
              await updateBuildHappyPathState(userId, {
                intake: { backlogItemId: itemId },
              }, buildId);
              happyPathState = { ...happyPathState, intake: { ...happyPathState.intake, backlogItemId: itemId } };
              logBuildActivity(buildId, "auto-intake:backlog", `Auto-created backlog item ${itemId} (${title})`);
            } catch (err) {
              console.warn("[reviewDesignDoc] auto-create backlog item failed:", err);
            }
          }

          // Auto-derive constrainedGoal if missing — fall back to the build
          // title. For triaged-BI builds the title was generated from the BI
          // body which itself was triaged, so the title IS the constrained
          // goal for governance purposes. For ad-hoc free-text builds where
          // the user explicitly set a goal via update_feature_brief, this
          // path is a no-op (the goal is already populated).
          //
          // Closes BI-0B3EAAC8: the existing reviewDesignDoc auto-advance
          // already auto-creates epic + backlog item but did NOT auto-derive
          // constrainedGoal or taxonomyNodeId, so triaged-BI builds got
          // stuck in ideate forever even when the BI body fully described
          // the work.
          if (!happyPathState.intake.constrainedGoal && updatedBuild.title) {
            try {
              const goal = updatedBuild.title.trim().slice(0, 280);
              await updateBuildHappyPathState(userId, {
                intake: { constrainedGoal: goal },
              }, buildId);
              happyPathState = {
                ...happyPathState,
                intake: { ...happyPathState.intake, constrainedGoal: goal },
              };
              logBuildActivity(buildId, "auto-intake:constrained-goal", `Auto-set constrainedGoal from build title`);
            } catch (err) {
              console.warn("[reviewDesignDoc] auto-set constrainedGoal failed:", err);
            }
          }

          // Auto-derive taxonomyNodeId (ad-hoc builds otherwise gate-block on
          // "Intake is incomplete" forever — see deriveIntakeTaxonomyAnchor).
          const anchor = deriveIntakeTaxonomyAnchor({
            taxonomyNodeId: happyPathState.intake.taxonomyNodeId,
            originatingBacklogItemId: updatedBuild.originatingBacklogItemId,
            buildId,
          });
          if (anchor) {
            try {
              await updateBuildHappyPathState(userId, {
                intake: { taxonomyNodeId: anchor },
              }, buildId);
              happyPathState = {
                ...happyPathState,
                intake: { ...happyPathState.intake, taxonomyNodeId: anchor },
              };
              logBuildActivity(buildId, "auto-intake:taxonomy-anchor", `Auto-set taxonomyNodeId=${anchor}`);
            } catch (err) {
              console.warn("[reviewDesignDoc] auto-set taxonomyNodeId failed:", err);
            }
          }

          const gate = checkPhaseGate("ideate", "plan", {
            kind: updatedBuild.kind,
            processSize: ((updatedBuild.plan as Record<string, unknown> | null)?.processSize as string | undefined) ?? "medium",
            designDoc: updatedBuild.designDoc,
            designReview: updatedBuild.designReview,
            happyPathState,
          });
          if (gate.allowed) {
            // EP-COST Phase 3: record ideate-phase cost rollup, start plan tracking, and compact thread
            const { completeBuildPhaseRun, startBuildPhaseRun } = await import("@/lib/integrate/build-phase-run");
            void completeBuildPhaseRun(buildId, "ideate");
            void startBuildPhaseRun(buildId, "plan").catch(() => {}); // swallow QuiescingError thrown during a self-upgrade drain (BI-QUIESCE-005)
            if (context?.threadId) {
              const { persistPhaseHandoffSummary } = await import("@/lib/integrate/phase-compaction-wire");
              void persistPhaseHandoffSummary(context.threadId, "ideate");
            }
            await prisma.featureBuild.update({ where: { buildId }, data: { phase: "plan" } });
            if (context?.threadId) agentEventBus.emit(context.threadId, { type: "phase:change", buildId, phase: "plan" });
            logBuildActivity(buildId, "phase:advance", "Phase advanced: ideate → plan");
            // Auto-dispatch plan generation so the build advances without
            // waiting for the operator to manually prompt the coworker. Mirrors
            // the ideate auto-dispatch pattern (plan-on-approval.ts).
            void import("@/lib/integrate/plan-on-approval").then(m =>
              m.dispatchPlanForApprovedBuild({ buildId, userId })
                .catch(err => console.error("[plan-on-approval] auto-dispatch failed:", err))
            );
          } else {
            logBuildActivity(buildId, "phase:gate-blocked", gate.reason ?? "unknown");
            // Surface the blocker to the agent so it can self-correct on the next
            // turn. Without this, the agent sees "review passed" and assumes
            // ideate is done — but the phase silently stays in ideate forever
            // because intake anchors (taxonomy, constrainedGoal) weren't set.
            // The agent has the tools (confirm_taxonomy_placement,
            // update_feature_brief) — it just didn't know they were required.
            phaseGateBlocker = gate.reason ?? null;
          }
        }
      } catch (err) {
        console.error("[reviewDesignDoc] auto-advance failed:", err);
      }

      const reviewMessage = (phaseGateBlocker
        ? `Design review: ${review.decision}. ${review.summary}\n\n` +
          `IMPORTANT: Phase did NOT advance to plan. Reason: ${phaseGateBlocker} ` +
          `Call confirm_taxonomy_placement (with the right taxonomyNodeId from suggest_taxonomy_placement) ` +
          `and update_feature_brief (with a concrete constrainedGoal) before re-running reviewDesignDoc.`
        : `Design review: ${review.decision}. ${review.summary}`) + archAdvisoryNote;
      return { success: true, message: reviewMessage, data: { review, phaseGateBlocker } };
    }

    case "reviewBuildPlan": {
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
          "You are the Enterprise Architect (DPF chief-architect lens) reviewing for architectural alignment. Advisory only — surface concerns and concrete plan edits, never block the gate.",
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
        const { isVerifiedFindingReviewEnabled } = await import("@/lib/integrate/build-studio-config");
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
          const { runBuildReviewDeliberation } = await import("@/lib/integrate/build-orchestrator");
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

      // Passed review → auto-advance if gate is satisfied.
      try {
        const { checkPhaseGate, canTransitionPhase, normalizeHappyPathState } = await import("@/lib/feature-build-types");
        const { deriveFeatureBuildDependencyGate, FEATURE_BUILD_DEPENDENCY_GATE_SELECT } = await import("@/lib/build/feature-build-dependencies");
        const updatedBuild = await prisma.featureBuild.findUnique({
          where: { buildId },
          select: {
            phase: true,
            plan: true,
            buildPlan: true,
            planReview: true,
            id: true,
            buildId: true,
            title: true,
            kind: true,
            parentEpicId: true,
            deliberationSummary: true,
            dependenciesOut: FEATURE_BUILD_DEPENDENCY_GATE_SELECT.dependenciesOut,
          },
        });
        if (updatedBuild && updatedBuild.phase === "plan" && canTransitionPhase("plan", "build")) {
          const plan = (updatedBuild.plan as Record<string, unknown> | null) ?? {};
          const happyPathState = normalizeHappyPathState(plan.happyPathState);
          const gate = checkPhaseGate("plan", "build", {
            kind: updatedBuild.kind,
            // Right-sizing matrix: persisted on plan.processSize at promote time.
            processSize: (plan.processSize as string | undefined) ?? "medium",
            buildPlan: updatedBuild.buildPlan,
            planReview: updatedBuild.planReview,
            happyPathState,
          });
          if (gate.allowed) {
            const dependencyGate = deriveFeatureBuildDependencyGate(updatedBuild);
            if (!dependencyGate.allowed) {
              logBuildActivity(buildId, "phase:gate-blocked", dependencyGate.message);
            } else {
              // WWMD kernel gate. The structural checkPhaseGate + dependency gate
              // above are necessary but not sufficient: the decision kernel
              // (principle_decide) is the authority on whether plan→build honors
              // platform principles. The advance-phase HTTP route runs this gate;
              // this agentic-loop auto-advance MUST too, or local-model builds
              // silently bypass WWMD. Fail OPEN on evaluator error so a kernel
              // hiccup can't wedge the streamlined flow — but a genuine principle
              // conflict (gate not allowed) blocks the auto-advance and surfaces a
              // DecisionInteraction for operator review.
              let decisionAllowed = true;
              try {
                const { evaluateBuildStudioPlanAdvancementGate } = await import("@/lib/decision-perspective/build-studio-gate");
                const decisionGate = await evaluateBuildStudioPlanAdvancementGate({
                  db: prisma,
                  build: {
                    buildId: updatedBuild.buildId,
                    title: updatedBuild.title ?? updatedBuild.buildId,
                    phase: "plan",
                    planReview: updatedBuild.planReview as Parameters<typeof evaluateBuildStudioPlanAdvancementGate>[0]["build"]["planReview"],
                    deliberationSummary: updatedBuild.deliberationSummary as Parameters<typeof evaluateBuildStudioPlanAdvancementGate>[0]["build"]["deliberationSummary"],
                  },
                  triggeredByUserId: userId,
                });
                if (!decisionGate.allowed) {
                  decisionAllowed = false;
                  logBuildActivity(buildId, "wwmd:gate-blocked", decisionGate.operatorMessage ?? "Decision kernel withheld plan→build advancement.");
                }
              } catch (wwmdErr) {
                console.error("[reviewBuildPlan] WWMD gate errored (failing open):", wwmdErr);
              }
              if (decisionAllowed) {
              // Initialize the build branch BEFORE flipping the phase. If the
              // phase flip lands without buildBranch set, deploy_feature runs
              // on whatever the current sandbox HEAD is — picking up leftover
              // work from earlier builds. Gate the transition on the branch
              // actually being ready so the "phase: build" record is always
              // paired with a valid buildBranch on the FeatureBuild row.
              try {
                const { isSandboxAvailable, startBuildBranch } = await import("@/lib/integrate/sandbox/build-branch");
                const sandboxUp = await isSandboxAvailable();
                if (!sandboxUp) {
                  logBuildActivity(buildId, "phase:gate-blocked", "Auto-advance to build blocked: sandbox not running. Start the sandbox, then call start_build.");
                } else {
                  await startBuildBranch(buildId);
                  // EP-COST Phase 3: record plan-phase cost rollup, start build tracking, and compact thread
                  const { completeBuildPhaseRun, startBuildPhaseRun } = await import("@/lib/integrate/build-phase-run");
                  void completeBuildPhaseRun(buildId, "plan");
                  void startBuildPhaseRun(buildId, "build").catch(() => {}); // swallow QuiescingError thrown during a self-upgrade drain (BI-QUIESCE-005)
                  if (context?.threadId) {
                    const { persistPhaseHandoffSummary } = await import("@/lib/integrate/phase-compaction-wire");
                    void persistPhaseHandoffSummary(context.threadId, "plan");
                  }
                  await prisma.featureBuild.update({ where: { buildId }, data: { phase: "build" } });
                  if (context?.threadId) agentEventBus.emit(context.threadId, { type: "phase:change", buildId, phase: "build" });
                  logBuildActivity(buildId, "phase:advance", "Phase advanced: plan → build (buildBranch initialized)");
                  // Auto-dispatch the build orchestrator so specialist code generation
                  // runs immediately without waiting for an operator to prompt the
                  // coworker. The orchestrator handles the full build phase including
                  // task dispatch, progress tracking, and auto-advance to review.
                  void import("@/lib/integrate/build-on-plan-approval").then(m =>
                    m.dispatchBuildForApprovedPlan({ buildId, userId })
                      .catch(err => console.error("[build-on-plan-approval] auto-dispatch failed:", err))
                  );
                }
              } catch (branchErr) {
                logBuildActivity(buildId, "phase:gate-blocked", `startBuildBranch failed: ${(branchErr as Error).message?.slice(0, 200)}`);
              }
              }
            }
          } else {
            logBuildActivity(buildId, "phase:gate-blocked", gate.reason ?? "unknown");
          }
        }
      } catch (err) {
        console.error("[reviewBuildPlan] auto-advance failed:", err);
      }

      return { success: true, message: `Plan review: ${review.decision}. ${review.summary}${archAdvisoryNote}`, data: { review } };
    }

    case "inspect_build_code_impact": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) {
        return { success: false, error: "No active build.", message: "No active build." };
      }

      const build = await prisma.featureBuild.findUnique({
        where: { buildId },
        select: { buildId: true, title: true, diffPatch: true },
      });
      if (!build?.diffPatch) {
        return {
          success: false,
          error: "No diff patch saved yet.",
          message: "No build diff is available yet. Run the build and save a diff before inspecting code impact.",
        };
      }

      const { analyzeChangeImpact, formatImpactForChat } = await import("@/lib/change-impact");
      const report = await analyzeChangeImpact(build.diffPatch);
      return {
        success: true,
        message: `Impact analysis for ${build.title ?? build.buildId}:\n\n${formatImpactForChat(report)}`,
        data: {
          buildId: build.buildId,
          report,
        },
      };
    }

    case "reconcile_build_engines": {
      const offline = params["offline"] === true;
      const { reconcileBuildEngines } = await import("@/lib/integrate/build-engine-reconcile");
      const summary = await reconcileBuildEngines({ offline, actorUserId: userId });
      return {
        success: true,
        message:
          summary.restored.length === 0
            ? `No engines needed restoring (checked ${summary.checked}, skipped ${summary.skipped}).`
            : `Restored ${summary.restored.length} engine(s): ${summary.restored
                .map((r) => `${r.engineId} (${r.outcome})`)
                .join(", ")}.`,
        data: summary,
      };
    }

    case "provision_build_engine": {
      const engineId = optionalString(params["engineId"]);
      if (!engineId) {
        return {
          success: false,
          error: "engineId is required.",
          message: "Provide engineId — one of 'claude', 'codex', 'grok'.",
        };
      }
      const offline = params["offline"] === true;
      const { provisionBuildEngine } = await import("@/lib/integrate/build-engine-provision");
      const outcome = await provisionBuildEngine(engineId, { offline, actorUserId: userId });
      const ok = outcome.kind === "provisioned" || outcome.kind === "already-present";
      const message =
        outcome.kind === "provisioned"
          ? `Provisioned ${engineId}${outcome.version ? ` v${outcome.version}` : ""} via ${outcome.recipe}; verified present in the sandbox.`
          : outcome.kind === "already-present"
            ? `${engineId} is already installed in the sandbox${outcome.version ? ` (v${outcome.version})` : ""}.`
            : outcome.kind === "no-recipe"
              ? `Cannot provision ${engineId}: ${outcome.reason}.`
              : outcome.kind === "verify-failed"
                ? `Ran the ${outcome.recipe} recipe for ${engineId} but it is still not present: ${outcome.error}`
                : `Failed to provision ${engineId}: ${outcome.error}`;
      return { success: ok, message, data: outcome };
    }

    case "get_build_engine_readiness": {
      const refresh = params["refresh"] === true;
      // Shared with the /platform/ai/build-studio config page's proactive probe
      // + "Probe all engines" action (BI-805D01E4): one implementation of
      // load-vs-live-probe. Live rows carry the per-engine failure reason.
      const { loadBuildEngineReadiness, probeBuildEngineReadiness } = await import(
        "@/lib/integrate/build-engine-readiness"
      );
      const readiness = refresh
        ? await probeBuildEngineReadiness()
        : await loadBuildEngineReadiness();

      const present = readiness.filter((r) => r.present === true).map((r) => r.engineId);
      const absent = readiness.filter((r) => r.present === false).map((r) => r.engineId);
      const unknown = readiness.filter((r) => r.present === null).map((r) => r.engineId);

      return {
        success: true,
        message:
          readiness.length === 0
            ? "No build engines registered yet. Run sync-engine-registry to populate the BuildEngine catalog from build-engines.json."
            : `Build engines — present: ${present.join(", ") || "none"}; not installed: ${absent.join(", ") || "none"}; never probed: ${unknown.join(", ") || "none"}.${refresh ? " (live re-probe)" : " (last known state — pass refresh:true to re-probe)"}`,
        data: { engines: readiness, refreshed: refresh },
      };
    }

    case "diagnose_sandbox": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

      const { diagnoseSandboxReadiness } = await import("@/lib/integrate/sandbox/sandbox-admin");
      const snapshot = await diagnoseSandboxReadiness({
        buildId,
        expectedWorkspaceRoot: optionalString(params["expectedWorkspaceRoot"]),
      });

      return {
        success: true,
        message: `Sandbox readiness: ${snapshot.state}. ${snapshot.summary}`,
        data: {
          ...snapshot,
        },
      };
    }

    case "recover_sandbox": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

      const action = params["action"];
      if (!isSandboxRecoveryAction(action)) {
        return {
          success: false,
          error: "invalid_action",
          message: "Invalid sandbox recovery action.",
        };
      }

      const confirmation = params["confirmation"] && typeof params["confirmation"] === "object"
        ? params["confirmation"] as { discardSandboxChanges?: boolean; acknowledgeReset?: boolean; reason?: string }
        : null;
      const { recoverSandbox } = await import("@/lib/integrate/sandbox/sandbox-recovery");
      const result = await recoverSandbox({
        buildId,
        action,
        confirmation,
      });

      return {
        success: result.success,
        error: result.error,
        message: result.message,
        entityId: buildId,
        data: result.snapshot ? { ...result.snapshot } : undefined,
      };
    }

    case "check_sandbox": {
      const sandboxId = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
      try {
        const { exec: execCb } = lazyChildProcess();
        const { promisify } = lazyUtil();
        const execAsync = promisify(execCb);
        const { stdout } = await execAsync(`docker inspect -f "{{.State.Status}}" ${sandboxId}`, { timeout: 5_000 });
        const status = stdout.trim(); // "running", "exited", "paused", etc.
        const isRunning = status === "running";
        return {
          success: true,
          message: isRunning
            ? `Sandbox (${sandboxId}) is running and ready.`
            : `Sandbox (${sandboxId}) exists but is ${status}. Call start_sandbox to start it.`,
          data: { status: isRunning ? "running" : "stopped", containerId: sandboxId },
        };
      } catch {
        return {
          success: true,
          message: `Sandbox container (${sandboxId}) does not exist. Call diagnose_sandbox for the authoritative Build Studio recovery actions.`,
          data: { status: "not_found", containerId: sandboxId },
        };
      }
    }

    case "start_sandbox": {
      const sandboxId = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
      try {
        const { exec: execCb } = lazyChildProcess();
        const { promisify } = lazyUtil();
        const execAsync = promisify(execCb);

        // First check current status
        let currentStatus = "unknown";
        try {
          const { stdout } = await execAsync(`docker inspect -f "{{.State.Status}}" ${sandboxId}`, { timeout: 5_000 });
          currentStatus = stdout.trim();
        } catch {
          return {
            success: false,
            error: "Sandbox container not found.",
            message: `The sandbox container (${sandboxId}) has never been created or is not registered. Call diagnose_sandbox so Build Studio can classify the sandbox and surface governed recovery actions.`,
          };
        }

        if (currentStatus === "running") {
          return { success: true, message: `Sandbox (${sandboxId}) is already running.`, data: { status: "running" } };
        }

        // Start the container
        await execAsync(`docker start ${sandboxId}`, { timeout: 15_000 });

        // Wait up to 20s for it to become running
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 1_500));
          try {
            const { stdout } = await execAsync(`docker inspect -f "{{.State.Status}}" ${sandboxId}`, { timeout: 3_000 });
            if (stdout.trim() === "running") {
              // Auto-replay (EP-2D477458 Phase 3): a freshly (re)started sandbox
              // may have lost any on-demand-provisioned engine. Restore desired,
              // previously-provisioned, now-absent engines in the background —
              // a no-op for fresh or baked-only sandboxes.
              void import("@/lib/integrate/build-engine-reconcile")
                .then((m) => m.reconcileBuildEngines({ actorUserId: userId }))
                .catch(() => undefined);
              return { success: true, message: `Sandbox (${sandboxId}) started successfully and is ready.`, data: { status: "running" } };
            }
          } catch { /* keep waiting */ }
        }

        return {
          success: false,
          error: "Sandbox start timed out.",
          message: `The sandbox container (${sandboxId}) was started but did not become ready within 20 seconds. It may still be initialising — try check_sandbox again in a moment.`,
        };
      } catch (err) {
        return {
          success: false,
          error: "Failed to start sandbox.",
          message: `Could not start sandbox (${sandboxId}): ${(err as Error).message?.slice(0, 200)}`,
        };
      }
    }

    case "start_build": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

      try {
        const { assertFeatureBuildDependenciesSatisfied } = await import("@/lib/build/feature-build-dependencies");
        await assertFeatureBuildDependenciesSatisfied({ db: prisma, buildId });
      } catch (err) {
        return {
          success: false,
          error: "Dependency gate blocked.",
          message: getErrorMessage(err),
        };
      }

      const { isSandboxAvailable, startBuildBranch } = await import("@/lib/integrate/sandbox/build-branch");

      const available = await isSandboxAvailable();
      if (!available) {
        return {
          success: false,
          error: "Sandbox container is not running.",
          message: "The sandbox is not running. Call check_sandbox to see the status, then start_sandbox if it is stopped.",
        };
      }

      await startBuildBranch(buildId);

      try {
        const { startSandboxDevServer } = await import("@/lib/sandbox");
        await startSandboxDevServer(process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1");
      } catch (devErr) {
        console.log(`[start_build] preview server start failed (non-fatal): ${(devErr as Error).message?.slice(0, 100)}`);
      }

      const { agentEventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) agentEventBus.emit(context.threadId, { type: "phase:change", buildId, phase: "build" });
      logBuildActivity(buildId, "start_build", `Build branch ready for ${buildId}.`);
      return {
        success: true,
        message: `Build workspace ready. Sandbox is running on port ${process.env.SANDBOX_PORT ?? "3035"}. Start writing files.`,
        entityId: buildId,
        data: { containerId: process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1", port: Number(process.env.SANDBOX_PORT ?? "3035") },
      };
    }

    case "generate_code":
    case "iterate_sandbox":
      // Removed: these tools caused runaway loops by spawning nested LLM calls.
      // Use write_sandbox_file / edit_sandbox_file / run_sandbox_command directly.
      return { success: false, error: "Tool removed.", message: "generate_code and iterate_sandbox have been removed. Use write_sandbox_file, edit_sandbox_file, and run_sandbox_command directly to build the feature." };


    case "run_sandbox_tests": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

      const { isSandboxAvailable: rstAvail } = await import("@/lib/integrate/sandbox/build-branch");
      if (!(await rstAvail())) {
        return { success: false, error: "Sandbox not running.", message: "The sandbox (dpf-sandbox-1) is not running. Call start_build first." };
      }
      const rstSandboxId = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
      const { runSandboxTests, diagnoseTestFailures } = await import("@/lib/coding-agent");
      const autoFix = params.auto_fix === true;
      const MAX_FIX_ATTEMPTS = 3;

      // Scope verification to the build's changed files so the feature's OWN
      // tests gate the build (not just typecheck) and their output isn't
      // truncated behind the full monorepo suite.
      let rstChangedFiles: string[] = [];
      try {
        const { getSandboxStateForBuild } = await import("@/lib/build/sandbox-state");
        const rstState = await getSandboxStateForBuild(buildId);
        rstChangedFiles = rstState?.sourceDiffstat.map((entry) => entry.path) ?? [];
      } catch (err) {
        console.warn("[run_sandbox_tests] could not resolve changed files for scoping:", (err as Error)?.message);
      }

      let results = await runSandboxTests(rstSandboxId, { changedFiles: rstChangedFiles });
      let fixAttempts = 0;

      // Auto-fix loop: diagnose failures, apply fixes via LLM, re-test
      if (autoFix && !results.passed) {
        const { execInSandbox } = await import("@/lib/sandbox");
        const { routeAndCall } = await import("@/lib/routed-inference");
        const { agentEventBus } = await import("@/lib/agent-event-bus");

        while (!results.passed && fixAttempts < MAX_FIX_ATTEMPTS) {
          fixAttempts++;
          if (context?.threadId) {
            agentEventBus.emit(context.threadId, {
              type: "coding:test_fix_attempt" as "evidence:update",
              buildId,
              field: `attempt_${fixAttempts}_of_${MAX_FIX_ATTEMPTS}`,
            });
          }

          const diagnosis = diagnoseTestFailures(results);
          if (diagnosis.failingTests.length === 0) break;

          // Read failing source files for context
          const fileContents: string[] = [];
          const readFiles = new Set<string>();
          for (const failure of diagnosis.failingTests.slice(0, 3)) {
            for (const filePath of [failure.testFile, failure.sourceFile].filter(Boolean)) {
              if (readFiles.has(filePath!)) continue;
              readFiles.add(filePath!);
              try {
                const content = await execInSandbox(
                  rstSandboxId,
                  `cat "/workspace/${filePath}" 2>/dev/null | head -100 || echo "[not found]"`,
                );
                if (!content.includes("[not found]")) {
                  fileContents.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
                }
              } catch { /* skip */ }
            }
          }

          // On retry attempts, gather deeper context: follow imports and find
          // codebase patterns. The first attempt has the error + source file.
          // If that wasn't enough, the LLM needs to see HOW the imported modules
          // work and how other files solve similar problems.
          const deepContext: string[] = [];
          if (fixAttempts >= 2) {
            // 1. Follow imports: extract import paths from failing files, read their exports
            for (const filePath of readFiles) {
              try {
                const importLines = await execInSandbox(
                  rstSandboxId,
                  `grep -n "^import" "/workspace/${filePath}" 2>/dev/null || true`,
                );
                for (const line of importLines.split("\n")) {
                  // Match package imports like @dpf/db, @/lib/foo
                  const pkgMatch = line.match(/from\s+["'](@dpf\/[^"']+|@\/[^"']+)["']/);
                  if (!pkgMatch) continue;
                  const importPath = pkgMatch[1]!;
                  // Resolve to a file path
                  let resolvedPath = "";
                  if (importPath.startsWith("@dpf/db")) {
                    resolvedPath = "packages/db/src/index.ts";
                  } else if (importPath.startsWith("@/")) {
                    resolvedPath = `apps/web/${importPath.replace("@/", "lib/")}.ts`;
                  }
                  if (resolvedPath && !readFiles.has(resolvedPath)) {
                    readFiles.add(resolvedPath);
                    const modContent = await execInSandbox(
                      rstSandboxId,
                      `cat "/workspace/${resolvedPath}" 2>/dev/null | head -50 || echo "[not found]"`,
                    );
                    if (!modContent.includes("[not found]")) {
                      deepContext.push(`### ${resolvedPath} (imported by ${filePath})\n\`\`\`\n${modContent}\n\`\`\``);
                    }
                  }
                }
              } catch { /* skip */ }
            }

            // 2. Find codebase patterns: how do other files handle similar imports?
            if (!results.typeCheckPassed && results.typeCheckOutput) {
              // Extract the problematic symbol from the error (e.g. "'Prisma'")
              const symbolMatch = results.typeCheckOutput.match(/['"](\w+)['"]\s+cannot be used as a value/);
              if (symbolMatch) {
                try {
                  const grepResult = await execInSandbox(
                    rstSandboxId,
                    `grep -rn "import.*${symbolMatch[1]}" /workspace/apps/web/lib/ 2>/dev/null | grep -v node_modules | head -10 || true`,
                  );
                  if (grepResult.trim()) {
                    deepContext.push(`### How other files import "${symbolMatch[1]}"\n\`\`\`\n${grepResult}\n\`\`\``);
                  }
                } catch { /* skip */ }
              }
            }
          }

          // Ask LLM to produce a fix
          const fixPrompt = [
            "The following tests are failing. Diagnose and fix the SOURCE files (not the tests).",
            "",
            "## Test Output",
            "```",
            results.testOutput.slice(0, 3000),
            "```",
            "",
            results.typeCheckPassed ? "" : `## Type Check Errors\n\`\`\`\n${results.typeCheckOutput.slice(0, 2000)}\n\`\`\`\n`,
            "## Diagnosis",
            diagnosis.summary,
            "",
            "## Relevant Files",
            ...fileContents,
            ...(deepContext.length > 0 ? [
              "",
              "## Import Chain & Codebase Patterns (follow these — they show how the project actually works)",
              ...deepContext,
            ] : []),
            "",
            "IMPORTANT: If an import is type-only (export type) but used as a value, find an alternative approach.",
            "Look at how other files in this codebase solve the same problem.",
            "",
            "Output ONLY the fixed files in this format:",
            "### FILE: <path>",
            "```typescript",
            "<full file content>",
            "```",
          ].join("\n");

          try {
            const fixResult = await routeAndCall(
              [{ role: "user", content: fixPrompt }],
              "You are a debugging agent. Fix the failing code. Output only changed files.",
              "internal",
              { taskType: "code_generation" },
            );

            // Parse and write fixed files
            const filePattern = /### FILE: (.+?)\n```(?:typescript|tsx|ts|prisma|sql)?\n([\s\S]*?)```/g;
            let fixMatch;
            let filesFixed = 0;
            while ((fixMatch = filePattern.exec(fixResult.content)) !== null) {
              const cleanPath = fixMatch[1]!.trim().replace(/^\/?workspace\//, "");
              const dir = cleanPath.includes("/") ? cleanPath.substring(0, cleanPath.lastIndexOf("/")) : "";
              if (dir) await execInSandbox(rstSandboxId, `mkdir -p '/workspace/${dir}'`);
              const encoded = Buffer.from(fixMatch[2]!).toString("base64");
              await execInSandbox(rstSandboxId, `echo ${encoded} | base64 -d > '/workspace/${cleanPath}'`);
              filesFixed++;
            }

            if (filesFixed === 0) break; // LLM couldn't produce a fix

            logBuildActivity(buildId, "run_sandbox_tests", `Auto-fix attempt ${fixAttempts}: applied fixes to ${filesFixed} file(s).`);
          } catch {
            break; // LLM call failed — stop retrying
          }

          // Re-run tests (same scoping as the initial run)
          results = await runSandboxTests(rstSandboxId, { changedFiles: rstChangedFiles });
        }
      }

      const verificationData = {
        testsPassed: results.passed ? 1 : 0,
        testsFailed: results.passed ? 0 : 1,
        typecheckPassed: results.typeCheckPassed,
        testOutput: results.testOutput.slice(0, 5000),
        typeCheckOutput: results.typeCheckOutput.slice(0, 5000),
        autoFixAttempts: fixAttempts,
        autoFixEnabled: autoFix,
      };
      await prisma.featureBuild.update({
        where: { buildId },
        data: { verificationOut: verificationData as unknown as import("@dpf/db").Prisma.InputJsonValue },
      });
      const { agentEventBus: eventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) eventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "verificationOut" });
      const statusMsg = results.typeCheckPassed
        ? `Verification recorded: typecheck clean, unit test output captured for review.${fixAttempts > 0 ? ` Fixed after ${fixAttempts} attempt(s).` : ""}`
        : `Verification recorded: typecheck failed, unit test output captured for review.${fixAttempts > 0 ? ` Auto-fix attempted ${fixAttempts} time(s).` : ""}`;
      logBuildActivity(buildId, "run_sandbox_tests", statusMsg);

      return {
        success: true,
        message: statusMsg,
        data: {
          ...verificationData,
          buildId,
        },
      };
    }

    case "run_tool_script": {
      // Programmatic tool calling (R4 / P7): governed read-only code execution.
      // Standalone case — NOT part of the sandbox-file fall-through group below;
      // it must return before those labels so they keep sharing the
      // run_sandbox_command block. The handler mints a scoped read-only JWT and
      // runs the model's script in the sandbox; each inner callTool reenters
      // /api/mcp/v1 → governedExecuteTool (kernel gate + grants per call). Gated
      // by the tool_script_exec grant (default-deny) AND the
      // programmatic_tool_calling flag (default-off).
      const { runToolScript } = await import("@/lib/tak/tool-script");
      return runToolScript(params, {
        userId,
        agentId: context?.agentId,
        threadId: context?.threadId,
        routeContext: context?.routeContext,
      });
    }

    // ─── Sandbox File Tools ──────────────────────────────────────────────────
    // Shared auto-init: ensure sandbox is initialized before any file tool runs.
    // Falls through to the specific tool case after initialization.

    case "read_sandbox_file":
    case "write_sandbox_file":
    case "edit_sandbox_file":
    case "search_sandbox":
    case "list_sandbox_files":
    case "run_sandbox_command": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

      // Simple availability check — no slot management, no pool acquisition.
      // If the sandbox container is running, it is available. Period.
      const { isSandboxAvailable } = await import("@/lib/integrate/sandbox/build-branch");
      const { execInSandbox: sbExec } = await import("@/lib/sandbox");
      const available = await isSandboxAvailable();
      if (!available) {
        return {
          success: false,
          error: "Sandbox container is not running.",
          message: "The sandbox (dpf-sandbox-1) is not running. Call diagnose_sandbox and use the returned recovery action before retrying this file tool.",
        };
      }

      const execInSandbox = sbExec;
      const sandboxId = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";

      // ── Dispatch to specific tool ──
      // ── Direct filesystem tools (via shared Docker volume at /sandbox-workspace) ──
      // These use Node.js fs operations — no docker exec, no shell escaping.
      const { readFile, writeFile, mkdir, stat } = lazyFsPromises();
      const { join, dirname } = lazyPath();
      const SANDBOX_MOUNT = "/sandbox-workspace";

      const resolveSandboxPath = (p: string) => {
        const cleaned = p.replace(/^\/?workspace\//, "");
        const resolved = join(SANDBOX_MOUNT, cleaned);
        // Prevent path traversal
        if (!resolved.startsWith(SANDBOX_MOUNT)) throw new Error("Path traversal blocked");
        return { resolved, relative: cleaned };
      };

      if (toolName === "read_sandbox_file") {
        const { resolved, relative } = resolveSandboxPath(String(params.path ?? ""));
        const offset = params.offset ? Number(params.offset) : undefined;
        const limit = params.limit ? Number(params.limit) : undefined;
        try {
          const raw = await readFile(resolved, "utf-8");
          const allLines = raw.split("\n");
          const startLine = (offset ?? 1) - 1;
          const endLine = limit ? startLine + limit : allLines.length;
          const slice = allLines.slice(startLine, endLine);
          const numbered = slice.map((line: string, i: number) => `${String(startLine + i + 1).padStart(6)}\t${line}`).join("\n");
          const rangeMsg = offset || limit ? ` (lines ${startLine + 1}–${startLine + slice.length})` : "";
          return { success: true, message: `File: ${relative}${rangeMsg}`, data: { path: relative, content: numbered } };
        } catch {
          return { success: false, error: `File not found: ${relative}`, message: `Could not read ${relative}` };
        }
      }

      if (toolName === "write_sandbox_file") {
        const { resolved, relative } = resolveSandboxPath(String(params.path ?? ""));
        const content = String(params.content ?? "");
        if (!content) return { success: false, error: "content is required.", message: "Provide the file content." };
        try {
          await mkdir(dirname(resolved), { recursive: true });
          await writeFile(resolved, content, "utf-8");
          logBuildActivity(buildId, "write_sandbox_file", `Created ${relative} (${content.length} chars)`);
          return { success: true, message: `Created ${relative} (${content.length} chars).`, data: { path: relative } };
        } catch (err) {
          return { success: false, error: `Write failed: ${(err as Error).message?.slice(0, 200)}`, message: `Could not write ${relative}` };
        }
      }

      if (toolName === "edit_sandbox_file") {
        const { resolved, relative } = resolveSandboxPath(String(params.path ?? ""));

        // Line-based edit mode: replace a range of lines by number
        // More reliable than string matching for AI-generated edits
        const startLine = params.start_line ? Number(params.start_line) : undefined;
        const endLine = params.end_line ? Number(params.end_line) : undefined;
        const newContent = params.new_content ? String(params.new_content) : undefined;

        if (startLine && endLine && newContent !== undefined) {
          try {
            const current = await readFile(resolved, "utf-8");
            const lines = current.split("\n");
            if (startLine < 1 || endLine > lines.length || startLine > endLine) {
              return { success: false, error: `Invalid line range ${startLine}-${endLine} (file has ${lines.length} lines).`, message: `Line range out of bounds.` };
            }
            const before = lines.slice(0, startLine - 1);
            const after = lines.slice(endLine);
            const newLines = newContent.split("\n");
            const updated = [...before, ...newLines, ...after].join("\n");
            await writeFile(resolved, updated, "utf-8");
            logBuildActivity(buildId, "edit_sandbox_file", `Edited ${relative} lines ${startLine}-${endLine} (${endLine - startLine + 1} -> ${newLines.length} lines)`);
            return { success: true, message: `Edited ${relative}: replaced lines ${startLine}-${endLine} with ${newLines.length} lines.`, data: { path: relative, linesReplaced: endLine - startLine + 1, newLines: newLines.length } };
          } catch (err) {
            return { success: false, error: `Edit failed: ${(err as Error).message?.slice(0, 200)}`, message: `Could not edit ${relative}` };
          }
        }

        // String-matching edit mode (original)
        const oldText = String(params.old_text ?? "");
        const newText = String(params.new_text ?? "");
        const replaceAll = params.replace_all === true;
        if (!oldText) return { success: false, error: "old_text is required (or use start_line/end_line/new_content for line-based edit).", message: "Provide old_text to replace, or use line-based mode." };
        try {
          const current = await readFile(resolved, "utf-8");
          const occurrences = current.split(oldText).length - 1;
          if (occurrences === 0) return { success: false, error: `old_text not found in ${relative}. Use read_sandbox_file to see exact content, or use line-based edit (start_line, end_line, new_content).`, message: `Text not found. Try line-based edit instead.` };
          if (occurrences > 1 && !replaceAll) return { success: false, error: `old_text matches ${occurrences} locations in ${relative}. Provide more context to make it unique, or set replace_all: true.`, message: `Ambiguous match — ${occurrences} occurrences found. Add surrounding lines to make the match unique, or use replace_all.` };
          const updated = replaceAll ? current.split(oldText).join(newText) : current.replace(oldText, newText);
          await writeFile(resolved, updated, "utf-8");
          const countMsg = replaceAll ? ` (${occurrences} occurrences)` : "";
          logBuildActivity(buildId, "edit_sandbox_file", `Edited ${relative}${countMsg}`);
          return { success: true, message: `Edited ${relative}: replaced ${oldText.length} chars with ${newText.length} chars${countMsg}.`, data: { path: relative, replacements: replaceAll ? occurrences : 1 } };
        } catch (err) {
          return { success: false, error: `Edit failed: ${(err as Error).message?.slice(0, 200)}`, message: `Could not edit ${relative}` };
        }
      }

      if (toolName === "search_sandbox") {
        const pattern = String(params.pattern ?? "");
        const globFilter = params.glob ? String(params.glob) : "*.{ts,tsx,js,jsx}";
        const max = Number(params.maxResults) || 20;
        try {
          // Use grep on the mounted volume — runs in portal, not sandbox container
          const { exec: execCb } = lazyChildProcess();
          const { promisify } = lazyUtil();
          const execAsync = promisify(execCb);
          const { stdout } = await execAsync(
            `grep -rn --include='${globFilter}' '${pattern.replace(/'/g, "'\\''")}' ${SANDBOX_MOUNT}/apps/ ${SANDBOX_MOUNT}/packages/ 2>/dev/null | head -${max}`,
            { timeout: 15_000 },
          );
          const cleaned = stdout.replace(new RegExp(SANDBOX_MOUNT + "/", "g"), "");
          return { success: true, message: `Search results for "${pattern}"`, data: { pattern, results: cleaned } };
        } catch (err) {
          // grep exits with code 1 when no matches are found — this is NOT an error.
          // Distinguish "no matches" from actual sandbox failures.
          const execErr = err as { code?: number; killed?: boolean; signal?: string };
          if (execErr.code === 1) {
            return {
              success: true,
              message: `No matches found for "${pattern}" in ${globFilter} files. The sandbox is working — this search term simply doesn't exist in the codebase. Try a different keyword or check spelling.`,
              data: { pattern, results: "", matchCount: 0 },
            };
          }
          // Actual failure (timeout, mount not accessible, etc.)
          const errMsg = (err as Error).message?.slice(0, 200) ?? "Search failed";
          return { success: false, error: `Sandbox search error: ${errMsg}`, message: `Search failed — the sandbox may not be accessible. Error: ${errMsg}` };
        }
      }

      if (toolName === "list_sandbox_files") {
        const pattern = String(params.pattern ?? "**/*");
        try {
          const { exec: execCb } = lazyChildProcess();
          const { promisify } = lazyUtil();
          const execAsync = promisify(execCb);
          const findPattern = pattern.startsWith("/") ? pattern : `${SANDBOX_MOUNT}/${pattern}`;
          const { stdout } = await execAsync(
            `find ${SANDBOX_MOUNT} -path '${SANDBOX_MOUNT}/node_modules' -prune -o -path '${SANDBOX_MOUNT}/.pnpm-store' -prune -o -path '${SANDBOX_MOUNT}/.next' -prune -o -path '${findPattern}' -print 2>/dev/null | head -50`,
            { timeout: 10_000 },
          );
          const cleaned = stdout.split("\n").map((l: string) => l.replace(`${SANDBOX_MOUNT}/`, "")).filter(Boolean).join("\n");
          if (!cleaned) {
            return { success: true, message: `No files matching "${pattern}". The sandbox is working — this path pattern has no matches. Try a broader pattern like "apps/web/app/**/*.tsx".`, data: { pattern, files: "" } };
          }
          return { success: true, message: `Files matching "${pattern}"`, data: { pattern, files: cleaned } };
        } catch (err) {
          const errMsg = (err as Error).message?.slice(0, 200) ?? "List failed";
          return { success: false, error: `Sandbox file listing error: ${errMsg}`, message: `File listing failed — the sandbox may not be accessible. Error: ${errMsg}` };
        }
      }

      if (toolName === "run_sandbox_command") {
        const command = String(params.command ?? "");
        if (!command) return { success: false, error: "command is required.", message: "Provide a command to run." };

        // ── Command safety blocklist ─────────────────────────────────────────
        // Commands run inside the sandbox container (docker exec), not the host OS.
        // The container is isolated, but we still block commands that could:
        //   - Destroy the workspace beyond git recovery
        //   - Exfiltrate files to the internet
        //   - Escape the container or affect the host Docker daemon
        //   - Execute arbitrary code piped from the network
        const BLOCKED_PATTERNS = [
          /rm\s+-rf\s+\/(?!workspace)/i,       // rm -rf outside /workspace
          /rm\s+-rf\s+\/workspace\s*$/i,        // rm -rf /workspace itself
          /curl\s+.*\|\s*(ba)?sh/i,             // curl | sh (remote code exec)
          /wget\s+.*\|\s*(ba)?sh/i,             // wget | sh
          /curl\s+.*\|\s*node/i,                // curl | node
          /docker\s+(run|exec|build|rm|rmi)/i,  // docker escape attempts
          /--privileged/i,                       // container privilege escalation
          /\/proc\/\d+\/fd/i,                   // procfs fd access
          /nsenter/i,                            // namespace escape
          /chroot/i,                             // chroot escape
          /mount\b/i,                            // mount syscall
          /chmod\s+[0-7]*7[0-7]*\s+\/(?!workspace)/i, // chmod outside workspace
        ];
        const blocked = BLOCKED_PATTERNS.find(p => p.test(command));
        if (blocked) {
          console.warn(`[run_sandbox_command] BLOCKED: ${JSON.stringify(command.slice(0, 200))}`);
          return {
            success: false,
            error: "Command blocked by safety policy.",
            message: `This command is not permitted: "${command.slice(0, 100)}". Commands must operate within /workspace. Destructive operations outside the workspace, remote code execution, and container escape attempts are blocked.`,
          };
        }
        // ─────────────────────────────────────────────────────────────────────

        // Smart output truncation: keep errors (at the end) rather than progress noise (at the start)
        const truncateOutput = (raw: string, limit: number = 15000): string => {
          if (raw.length <= limit) return raw;
          // For build/typecheck output, extract error lines first
          const errorLines = raw.split("\n").filter((l) =>
            /error\s+TS\d|ERROR|FAIL|Error:|Cannot find|not assignable|does not exist|Module.*not found/i.test(l)
          );
          if (errorLines.length > 0 && errorLines.length < 200) {
            const errorSummary = errorLines.join("\n");
            if (errorSummary.length <= limit) {
              return `[${raw.split("\n").length} total lines, showing ${errorLines.length} error lines]\n${errorSummary}`;
            }
          }
          // Fall back to keeping the tail (where errors typically appear)
          return `[output truncated — showing last ${limit} chars of ${raw.length}]\n...${raw.slice(-limit)}`;
        };

        try {
          const output = await execInSandbox(sandboxId, `cd /workspace && ${command} 2>&1`);
          logBuildActivity(buildId, "run_sandbox_command", `Ran: ${command.slice(0, 100)}`);
          return {
            success: true,
            message: "Command completed.",
            data: { buildId, command, output: truncateOutput(output) },
          };
        } catch (err) {
          // Commands like tsc, prisma validate return non-zero exit codes when they
          // find errors. This is NOT a sandbox failure — it's useful output.
          const execErr = err as { stdout?: string; stderr?: string; message?: string; code?: number };
          const output = (execErr.stdout ?? "") + (execErr.stderr ?? "");
          const exitCode = execErr.code;

          // If we got output, the command ran — return the output so the AI can act on it
          if (output.trim()) {
            logBuildActivity(buildId, "run_sandbox_command", `Ran (exit ${exitCode}): ${command.slice(0, 100)}`);
            return {
              success: true,
              message: `Command exited with code ${exitCode}. Review the output for errors to fix.`,
              data: { buildId, command, output: truncateOutput(output), exitCode },
            };
          }

          // No output — actual sandbox connectivity issue
          const errMsg = execErr.message?.slice(0, 2000) || "Command failed";
          console.error(`[run_sandbox_command] FAILED (no output): ${JSON.stringify(command.slice(0, 100))} -> ${JSON.stringify(errMsg.slice(0, 200))}`);
          return { success: false, error: errMsg, message: `Command failed: ${command.slice(0, 100)}`, data: { command, output: errMsg } };
        }
      }

      return { success: false, error: "Unknown sandbox tool", message: "Internal error." };
    }

    case "validate_schema": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

      // Simple availability check — no slot management
      const { isSandboxAvailable } = await import("@/lib/integrate/sandbox/build-branch");
      const vsAvailable = await isSandboxAvailable();
      if (!vsAvailable) {
        return {
          success: false,
          error: "Sandbox container is not running.",
          message: "The sandbox (dpf-sandbox-1) is not running. Call start_build first.",
        };
      }
      const vsSandboxId = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";

      try {
        const { execInSandbox } = await import("@/lib/sandbox");
        const schemaContent = await execInSandbox(
          vsSandboxId,
          "cat /workspace/packages/db/prisma/schema.prisma",
        );
        const { validatePrismaSchema, formatSchemaValidation } = await import("@/lib/integrate/schema-validator");
        const result = validatePrismaSchema(schemaContent);

        logBuildActivity(buildId, "validate_schema", result.summary);

        if (!result.valid) {
          return {
            success: false,
            error: "Schema validation failed",
            message: formatSchemaValidation(result),
            data: result as unknown as Record<string, unknown>,
          };
        }

        return {
          success: true,
          message: formatSchemaValidation(result),
          data: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return { success: false, error: "Schema validation error", message: err instanceof Error ? err.message : "Failed to validate schema" };
      }
    }

    case "deploy_feature": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({
        where: { buildId },
        select: { sandboxId: true, buildBranch: true, phase: true, createdById: true, designDoc: true },
      });
      if (!build || build.createdById !== userId) {
        return { success: false, error: "Build not found.", message: `No active build ${buildId} was found for this user.` };
      }
      if (!build?.sandboxId) return { success: false, error: "Sandbox not running.", message: "No sandbox." };
      // Invariant: buildBranch must be set once we're in build phase or later.
      // Its absence means startBuildBranch never ran — so the sandbox tree
      // is on whatever HEAD happened to be (client branch or baseline), and
      // any diff we extract will pick up leaked work from earlier builds.
      // Refuse to deploy until start_build runs and registers a buildBranch.
      if (!build.buildBranch) {
        return {
          success: false,
          error: "Build branch not initialized.",
          message: "This build has no buildBranch on record — start_build never completed. Run start_build to create and register build/<buildId>, then retry deploy_feature. Deploying without a build branch would include leaked changes from prior builds.",
        };
      }

      const { diagnoseSandboxReadiness } = await import("@/lib/integrate/sandbox/sandbox-admin");
      const { assertSandboxReadyForDeploy } = await import("@/lib/integrate/sandbox/sandbox-readiness-gate");
      const readiness = await diagnoseSandboxReadiness({ buildId });
      const readinessGate = assertSandboxReadyForDeploy(readiness);
      if (!readinessGate.ok) {
        logBuildActivity(buildId, "deploy_feature", readinessGate.message);
        return {
          success: false,
          error: "Sandbox readiness blocked deploy_feature.",
          message: readinessGate.message,
          data: { ...readiness },
        };
      }

      const devConfig = await prisma.platformDevConfig.findUnique({
        where: { id: "singleton" },
        select: { contributionMode: true, gitRemoteUrl: true },
      });
      const { getPlatformDevPolicyState } = await import("@/lib/platform-dev-policy");
      const policyState = getPlatformDevPolicyState(devConfig);
      if (policyState === "policy_pending") {
        return {
          success: false,
          error: "Platform development policy not configured.",
          message:
            "Build Studio can keep editing and validating in the shared workspace, but production promotion stays blocked until Platform Development is configured in the portal. Go to Admin > Platform Development and choose whether this install stays private or can contribute upstream.",
        };
      }

      // Extract diff from sandbox. Pass clientBranch as the diff base so
      // committed work on the build branch (`git commit` from generate_code)
      // is captured — without the base ref, `git diff --cached` only sees
      // staged-but-uncommitted changes and returns empty for any build whose
      // agent committed before deploy_feature ran.
      const { extractAndCategorizeDiff, scanForDestructiveOps, isNowInWindow } = await import("@/lib/integrate/sandbox/sandbox-promotion");
      const { getClientIdentity } = await import("@/lib/integrate/sandbox/build-branch");
      const { clientBranch } = await getClientIdentity();
      const extracted = await extractAndCategorizeDiff(build.sandboxId, { baseRef: clientBranch });
      if (!extracted.fullDiff.trim()) {
        await prisma.featureBuild.update({
          where: { buildId },
          data: { diffPatch: "", diffSummary: "" },
        });
        const noDiffMessage = "No releasable source changes were found in the sandbox. This build currently has only generated/cache churn or no real code changes, so release preparation cannot continue until implementation produces a real source diff.";
        logBuildActivity(buildId, "deploy_feature", noDiffMessage);
        return {
          success: false,
          error: "No releasable source changes found.",
          message: noDiffMessage,
          data: {
            diffLength: 0,
            codeFiles: 0,
            migrationFiles: 0,
          },
        };
      }

      // Guard: schema regression check.
      // If the diff removes existing fields/models from schema.prisma, the sandbox
      // was initialized from a stale portal image and this diff would silently
      // regress main's schema. Block deploy and surface the removed lines so the
      // operator knows what drifted.
      if (extracted.schemaRegressions.length > 0) {
        const regressionSample = extracted.schemaRegressions.slice(0, 10).join("\n");
        const regressionMessage =
          `Schema regression detected in sandbox diff — ${extracted.schemaRegressions.length} existing field(s) or model declaration(s) would be removed from packages/db/prisma/schema.prisma. ` +
          `This almost always means the sandbox was initialized from a portal image that predates recent schema changes on main. ` +
          `Rebuild the sandbox from a fresh image (Admin → Build Studio → Rebuild Sandbox) and re-run the build before deploying.\n\n` +
          `Removed lines (first 10):\n${regressionSample}`;
        logBuildActivity(buildId, "deploy_feature", regressionMessage);
        return {
          success: false,
          error: "Schema regression detected.",
          message: regressionMessage,
          data: {
            schemaRegressions: extracted.schemaRegressions,
            regressionCount: extracted.schemaRegressions.length,
          },
        };
      }

      // Capture commit hashes alongside the diff so the contribution flow
      // (which pushes build/<buildId> upstream) has the exact list of
      // commits being submitted. Without this, FB.gitCommitHashes stays
      // empty for committed-work builds and contribute_to_hive cannot
      // attribute the PR's commits back to specific FBs.
      const { listSandboxCommitsAheadOfBase } = await import("@/lib/integrate/sandbox/sandbox");
      const commitHashes = await listSandboxCommitsAheadOfBase(build.sandboxId, clientBranch);

      await prisma.featureBuild.update({
        where: { buildId },
        data: {
          diffPatch: extracted.fullDiff,
          diffSummary: extracted.fullDiff.slice(0, 500),
          gitCommitHashes: commitHashes,
        },
      });

      // Compute + cache the per-change disposition suggestion (EP-1A78BAE1) so
      // the ship UI / coworker can prefill Keep vs Share. The human still makes
      // the final call via set_change_disposition; this only pre-fills.
      // Non-fatal — a failed suggestion leaves the fail-closed default.
      try {
        const { suggestDisposition } = await import("@/lib/integrate/disposition");
        const { loadPrivatePathPatterns, compilePrivatePathMatcher, stripPrivatePathsFromDiff } =
          await import("@/lib/integrate/private-paths");
        const outboundEmpty = !stripPrivatePathsFromDiff(
          extracted.fullDiff,
          compilePrivatePathMatcher(await loadPrivatePathPatterns({ prisma })),
        ).kept.trim();
        let reusabilityScope: "one_off" | "parameterizable" | "already_generic" | null = null;
        const dd = build.designDoc as Record<string, unknown> | null;
        const scope = (dd?.reusabilityAnalysis as { scope?: string } | undefined)?.scope;
        if (scope === "one_off" || scope === "parameterizable" || scope === "already_generic") {
          reusabilityScope = scope;
        }
        let orgSpecificHits = 0;
        try {
          const { runSanitizationScan } = await import("@/lib/integrate/contribution-review");
          const san = await runSanitizationScan(extracted.fullDiff);
          orgSpecificHits = san.mustFixCount;
        } catch { /* sanitization optional */ }
        const suggestion = suggestDisposition({ reusabilityScope, orgSpecificHits, outboundEmpty });
        await prisma.featureBuild.update({
          where: { buildId },
          data: {
            dispositionSuggested: suggestion.suggested,
            dispositionSuggestionReason: suggestion.reason,
            dispositionSource: "suggested",
          },
        });
        logBuildActivity(buildId, "deploy_feature", `disposition suggestion: ${suggestion.suggested} — ${suggestion.reason}`);
      } catch (err) {
        console.warn("[deploy_feature] disposition suggestion failed:", err);
      }

      // Scan migrations for destructive operations
      let destructiveWarnings: string[] = [];
      if (extracted.hasMigrations) {
        destructiveWarnings = scanForDestructiveOps(extracted.fullDiff);
      }

      // Check deployment window availability
      let windowStatus = "No business profile configured — deployment unrestricted.";
      try {
        const profile = await prisma.businessProfile.findFirst({
          where: { isActive: true },
          include: { deploymentWindows: true, blackoutPeriods: true },
        });
        if (profile) {
          const now = new Date();
          const activeBlackout = profile.blackoutPeriods.find(
            (bp) => bp.startAt <= now && bp.endAt >= now,
          );
          if (activeBlackout) {
            windowStatus = `Blackout active until ${activeBlackout.endAt.toISOString()}.`;
          } else {
            const matchingWindows = profile.deploymentWindows.filter(
              (w) => w.allowedChangeTypes.includes("normal") && w.allowedRiskLevels.includes("low"),
            );
            if (matchingWindows.length > 0) {
              windowStatus = isNowInWindow(matchingWindows)
                ? "Deployment window is open now."
                : `Not in a deployment window. Available: ${matchingWindows.map((w) => `${w.name}: ${w.startTime}-${w.endTime}`).join("; ")}`;
            } else {
              windowStatus = "No deployment windows configured — deployment unrestricted.";
            }
          }
        }
      } catch {
        // Non-fatal — window check is advisory at this stage
      }

      // Run change impact analysis (EP-BUILD-HANDOFF-002 Phase 2b)
      let impactReport: Awaited<ReturnType<typeof import("@/lib/change-impact").analyzeChangeImpact>> | null = null;
      let impactSummary = "";
      try {
        const { analyzeChangeImpact, formatImpactForChat } = await import("@/lib/change-impact");
        impactReport = await analyzeChangeImpact(extracted.fullDiff);
        impactSummary = formatImpactForChat(impactReport);
      } catch (err) {
        console.warn("[deploy_feature] impact analysis failed:", err);
      }

      // Resolve approval authority (EP-BUILD-HANDOFF-002 Phase 2b)
      let authorityInfo = "";
      try {
        const { resolveApprovalAuthority, isCurrentUserTheAuthority, formatAuthorityForChat } = await import("@/lib/approval-authority");
        const riskLevel = impactReport?.riskLevel ?? "low";
        const authority = await resolveApprovalAuthority("deployment", "normal", riskLevel, userId);
        const isSelf = isCurrentUserTheAuthority(authority, userId);
        authorityInfo = formatAuthorityForChat(authority, isSelf);
      } catch (err) {
        console.warn("[deploy_feature] authority resolution failed:", err);
      }

      // Contribution mode awareness (EP-BUILD-HANDOFF-002 Phase 2e extension)
      let contributionModeInfo = "";
      try {
        const mode = devConfig?.contributionMode ?? "private";

        if ((mode === "private" || mode === "fork_only") && !devConfig?.gitRemoteUrl) {
          // Count untracked shipped features for escalating warning
          const untrackedCount = await prisma.featureBuild.count({
            where: { phase: "complete", gitCommitHashes: { isEmpty: true } },
          });

          if (untrackedCount >= 5) {
            contributionModeInfo = `**Warning:** You have ${untrackedCount} custom features with no backup. This represents significant business value that could be lost in a container rebuild, Docker update, or system recovery. Setting up a git repository takes about 10 minutes and protects all your customizations. See Admin > Platform Development.`;
          } else if (untrackedCount >= 2) {
            contributionModeInfo = `**Note:** You now have ${untrackedCount} custom features deployed without version control. If your Docker containers are rebuilt, these changes could be lost. I'd recommend setting up a git repository -- see Admin > Platform Development.`;
          } else if (untrackedCount >= 1) {
            contributionModeInfo = "Note: since no git repository is configured, customizations exist only in your production container. You can set up a repository in Admin > Platform Development to protect your work.";
          }
        }
      } catch (err) {
        console.warn("[deploy_feature] contribution mode check failed:", err);
      }

      const messageParts = [
        `Diff extracted: ${extracted.codeFiles.length} code file(s), ${extracted.migrationFiles.length} migration(s).`,
        windowStatus,
      ];
      if (destructiveWarnings.length > 0) {
        messageParts.push(`WARNING: ${destructiveWarnings.length} destructive operation(s) detected: ${destructiveWarnings.join("; ")}`);
      }
      if (impactSummary) {
        messageParts.push("", impactSummary);
      }
      if (authorityInfo) {
        messageParts.push("", authorityInfo);
      }
      if (contributionModeInfo) {
        messageParts.push("", contributionModeInfo);
      }

      logBuildActivity(buildId, "deploy_feature", messageParts.join(" "));

      return {
        success: true,
        message: messageParts.join("\n"),
        data: {
          diffLength: extracted.fullDiff.length,
          summary: extracted.fullDiff.slice(0, 500),
          codeFiles: extracted.codeFiles.length,
          migrationFiles: extracted.migrationFiles.length,
          destructiveWarnings,
          windowStatus,
          impactReport,
        },
      };
    }

    // ─── Portal PR Creation & Merge ────────────────────────────────────────

    case "create_portal_pr": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

      const build = await prisma.featureBuild.findUnique({
        where: { buildId },
        select: {
          id: true, title: true, diffPatch: true, buildBranch: true,
          description: true, gitCommitHashes: true, updatedAt: true, buildExecState: true,
          verificationOut: true, acceptanceMet: true, phase: true,
          designDoc: true, buildPlan: true,
          disposition: true, dispositionSuggestionReason: true,
          productVersions: {
            take: 1,
            orderBy: { shippedAt: "desc" },
            select: {
              id: true,
              promotions: { take: 1, orderBy: { createdAt: "desc" }, select: { promotionId: true, status: true } },
            },
          },
        },
      });
      if (!build) return { success: false, error: "Build not found.", message: "Build not found." };

      const diff = (build.diffPatch ?? "") as string;
      if (!diff.trim()) return { success: false, error: "No diff available.", message: "Run deploy_feature first to extract the diff." };

      const { buildSandboxStateFromRecord, assertSandboxReadyForPromotion, serializePlanDocument } = await import("@/lib/build/sandbox-state");
      const sandboxState = buildSandboxStateFromRecord({
        buildBranch: build.buildBranch,
        gitCommitHashes: build.gitCommitHashes,
        diffPatch: diff,
        updatedAt: build.updatedAt,
        planDocument: typeof build.buildPlan === "string" ? build.buildPlan : serializePlanDocument(build.buildPlan),
        description: build.description,
        buildExecState: build.buildExecState,
      });
      const promotionGate = assertSandboxReadyForPromotion(sandboxState);
      if (!promotionGate.ok) {
        logBuildActivity(buildId, "create_portal_pr", promotionGate.message);
        return {
          success: false,
          error: "Sandbox promotion integrity blocked PR creation.",
          message: `${promotionGate.message}\n\n${promotionGate.failures.join("\n")}`,
          data: {
            gate: {
              ok: false,
              failures: promotionGate.failures,
            },
            sandbox: promotionGate.state,
          },
        };
      }

      // Resolve the portal's own repo from git remote
      let repoOwner: string | null = null;
      let repoName: string | null = null;
      try {
        const { getRemoteUrl } = await import("@/lib/git-utils");
        const remoteUrl = await getRemoteUrl();
        if (remoteUrl) {
          const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
          if (match) { repoOwner = match[1]; repoName = match[2]; }
        }
      } catch { /* git may not be available */ }

      // Fallback to upstream URL if no local git
      if (!repoOwner) {
        const devConfig = await prisma.platformDevConfig.findUnique({
          where: { id: "singleton" },
          select: { upstreamRemoteUrl: true },
        });
        const url = devConfig?.upstreamRemoteUrl ?? "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git";
        const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
        if (match) { repoOwner = match[1]; repoName = match[2]; }
      }

      if (!repoOwner || !repoName) {
        return { success: false, error: "Cannot determine repository.", message: "No git remote or upstream URL configured." };
      }

      // Public-egress boundary (Private/Public Change Segregation): the
      // private/public filter applies ONLY when shipping to the PUBLIC hive. A
      // PR to the install's OWN repo is its private home and keeps the full
      // diff (proprietary paths included). This also closes the silent
      // fall-back-to-public leak — a customer's proprietary build never goes to
      // the canonical upstream unless that IS the configured target. Spec:
      // docs/superpowers/specs/2026-06-19-hive-contribution-architecture-and-egress-model.md
      let shareableDiff = diff;
      {
        const _egCfg = await prisma.platformDevConfig.findUnique({
          where: { id: "singleton" },
          select: { upstreamRemoteUrl: true },
        });
        const { classifyEgress } = await import("@/lib/integrate/contribution-egress");
        const egress = classifyEgress({ owner: repoOwner, repo: repoName }, _egCfg?.upstreamRemoteUrl);
        if (egress === "public-hive") {
          // Fail-closed disposition gate (EP-1A78BAE1): a public-hive PR may only
          // carry a change confirmed "shareable". Own-repo PRs skip this — that
          // is the install's private home.
          const { mayShareToPublicHive, privateDispositionBlockMessage } = await import("@/lib/integrate/disposition");
          if (!mayShareToPublicHive(build.disposition)) {
            logBuildActivity(buildId, "create_portal_pr", "blocked: change disposition is private (public-hive target)");
            return {
              success: false,
              error: "Change is kept private.",
              message: privateDispositionBlockMessage(build.dispositionSuggestionReason),
            };
          }
          const { loadPrivatePathPatterns, compilePrivatePathMatcher, stripPrivatePathsFromDiff } =
            await import("@/lib/integrate/private-paths");
          shareableDiff = stripPrivatePathsFromDiff(
            diff,
            compilePrivatePathMatcher(await loadPrivatePathPatterns({ prisma })),
          ).kept;
          if (!shareableDiff.trim()) {
            return {
              success: false,
              error: "Only private paths.",
              message:
                "This change only affects parts of your system you've marked private (see .dpf/private-paths or Admin > Platform Development), so there is nothing to share upstream.",
            };
          }
        }
      }

      // Resolve token
      const { resolveHiveToken, getPlatformIdentity, generatePrivateBranchName, generateAnonymousCommitMessage } = await import("@/lib/integrate/identity-privacy");
      const token = await resolveHiveToken();
      if (!token) {
        return { success: false, error: "No GitHub token available.", message: "Configure HIVE_CONTRIBUTION_TOKEN or a git credential to create PRs." };
      }

      // Run pre-PR gates
      const { runPrePRGates, formatGateReport } = await import("@/lib/integrate/pre-pr-gates");
      const gateResult = runPrePRGates(shareableDiff);

      // If gates block, return the report without creating a PR
      if (!gateResult.canProceed) {
        logBuildActivity(buildId, "create_portal_pr", `BLOCKED: ${gateResult.summary}`);
        return {
          success: false,
          error: "Pre-PR gates failed.",
          message: `The pre-PR security gates found blocking issues. Fix these before creating a PR.\n\n${formatGateReport(gateResult)}`,
          data: { gates: gateResult },
        };
      }

      // Build the PR
      const platformId = await getPlatformIdentity();
      const branchName = generatePrivateBranchName(platformId.clientId, build.title);

      const devConfigForDco = await prisma.platformDevConfig.findUnique({
        where: { id: "singleton" },
        select: { dcoAcceptedAt: true },
      });

      const commitMessage = generateAnonymousCommitMessage({
        title: build.title,
        buildId,
        productId: null,
        platformIdentity: platformId,
        dcoAcceptedAt: devConfigForDco?.dcoAcceptedAt ?? undefined,
      });

      // Build PR body with gate report and build evidence
      const verification = build.verificationOut as Record<string, unknown> | null;
      const typecheckPassed = verification?.typecheckPassed === true;
      const testsPassed = typeof verification?.testsPassed === "number" ? verification.testsPassed : 0;
      const testsFailed = typeof verification?.testsFailed === "number" ? verification.testsFailed : 0;

      // acceptanceMet (Json?) stores either a bare array or {acceptanceCriteria: [...]} — `.filter` must not assume array shape.
      const rawAcceptance = build.acceptanceMet as unknown;
      const acceptance: Array<{ met?: boolean }> = Array.isArray(rawAcceptance)
        ? (rawAcceptance as Array<{ met?: boolean }>)
        : rawAcceptance && typeof rawAcceptance === "object" && Array.isArray((rawAcceptance as { acceptanceCriteria?: unknown }).acceptanceCriteria)
          ? ((rawAcceptance as { acceptanceCriteria: Array<{ met?: boolean }> }).acceptanceCriteria)
          : [];
      const acMet = acceptance.filter((a) => a?.met === true).length;
      const acTotal = acceptance.length;

      const prBody = [
        `## ${build.title}`,
        "",
        `Build: \`${buildId}\` | Phase: \`${build.phase}\``,
        "",
        "### Verification",
        `- TypeCheck: ${typecheckPassed ? "PASSED" : "FAILED"}`,
        `- Tests: ${testsPassed} passed, ${testsFailed} failed`,
        `- Acceptance: ${acMet}/${acTotal} criteria met`,
        "",
        formatGateReport(gateResult),
        "",
        "---",
        `License: Apache-2.0 | ${platformId.dcoSignoff}`,
      ].join("\n");

      const prTitle = `feat(${buildId}): ${build.title}`;
      const labels = ["build-studio", "automated"];
      if (gateResult.requiresHumanReview) labels.push("needs-review");
      if (!typecheckPassed || testsFailed > 0) labels.push("verification-issues");

      const { createBranchAndPR, mergePR, commentOnPR } = await import("@/lib/integrate/github-api-commit");

      const prResult = await createBranchAndPR({
        headOwner: repoOwner,
        headRepo: repoName,
        baseOwner: repoOwner,
        baseRepo: repoName,
        branchName,
        commitMessage,
        diff: shareableDiff,
        prTitle,
        prBody,
        labels,
        token,
      });

      if (!prResult.prUrl || !prResult.prNumber) {
        logBuildActivity(buildId, "create_portal_pr", `Branch created (${branchName}) but PR creation failed.`);
        return {
          success: false,
          error: "PR creation failed.",
          message: `Branch \`${branchName}\` was created with the commit, but the pull request could not be opened. Check GitHub permissions.`,
          data: { branchName, commitSha: prResult.commitSha },
        };
      }

      // Capture the PR onto the build's Work Capsule so it becomes a queryable,
      // surfaceable fact (delivery visibility). The capsule's pullRequestUrl/
      // Number are READ by the change-lanes projection, the runtime-target
      // rollup, and the capsule presenters, but had no writer at PR-creation
      // time — so a build's PR stayed invisible until a delayed branch-name-
      // matched GitHub inventory snapshot backfilled it (or never). Migration-
      // free + best-effort: opening the PR must never hinge on this write.
      try {
        const { captureBuildPrOntoCapsule } = await import("@/lib/build/capture-build-pr");
        const cap = await captureBuildPrOntoCapsule({
          db: prisma,
          featureBuildId: build.id,
          prNumber: prResult.prNumber,
          prUrl: prResult.prUrl,
        });
        if (cap.captured > 0) {
          logBuildActivity(buildId, "create_portal_pr", `Linked PR #${prResult.prNumber} to ${cap.captured} work capsule(s).`);
        }
      } catch (err) {
        console.warn("[create_portal_pr] PR-capture onto capsule failed:", err);
      }

      // Auto-merge decision: all gates pass + build fully verified
      const fullyVerified = typecheckPassed && testsFailed === 0 && acMet === acTotal && acTotal > 0;
      let merged = false;

      if (!gateResult.requiresHumanReview && fullyVerified) {
        // Auto-merge via squash
        const mergeResult = await mergePR({
          owner: repoOwner,
          repo: repoName,
          prNumber: prResult.prNumber,
          commitTitle: `${prTitle} (#${prResult.prNumber})`,
          mergeMethod: "squash",
          token,
        });
        merged = mergeResult.merged;

        if (merged) {
          // Update lifecycle: FeatureBuild → complete, ChangePromotion → deployed
          await prisma.featureBuild.update({
            where: { buildId },
            data: { phase: "complete" },
          });
          const { recordReadyDependentsAfterCompletion } = await import("@/lib/build/feature-build-dependencies");
          await recordReadyDependentsAfterCompletion({ db: prisma, buildId }).catch((err) => {
            console.warn("[create_portal_pr] dependency readiness check failed:", err);
          });

          const promotion = build.productVersions[0]?.promotions[0];
          if (promotion) {
            await prisma.changePromotion.update({
              where: { promotionId: promotion.promotionId },
              data: { status: "deployed", deployedAt: new Date(), deploymentLog: `Auto-merged PR #${prResult.prNumber}` },
            });
          }

          logBuildActivity(buildId, "create_portal_pr", `PR #${prResult.prNumber} auto-merged. Build complete.`);
        } else {
          // Merge failed — post comment explaining why
          await commentOnPR({
            owner: repoOwner, repo: repoName, prNumber: prResult.prNumber,
            body: `Auto-merge failed. This PR requires manual review and merge.\n\n${formatGateReport(gateResult)}`,
            token,
          }).catch(() => {});

          logBuildActivity(buildId, "create_portal_pr", `PR #${prResult.prNumber} created but auto-merge failed.`);
        }
      } else {
        // Needs human review — post gate report as comment
        const reasons: string[] = [];
        if (gateResult.requiresHumanReview) reasons.push("security gate warnings");
        if (!typecheckPassed) reasons.push("TypeCheck failed");
        if (testsFailed > 0) reasons.push(`${testsFailed} test(s) failed`);
        if (acMet < acTotal) reasons.push(`${acTotal - acMet} acceptance criteria not met`);

        await commentOnPR({
          owner: repoOwner, repo: repoName, prNumber: prResult.prNumber,
          body: `This PR requires human review: ${reasons.join(", ")}.\n\n${formatGateReport(gateResult)}`,
          token,
        }).catch(() => {});

        logBuildActivity(buildId, "create_portal_pr", `PR #${prResult.prNumber} created — needs review: ${reasons.join(", ")}`);
      }

      const statusMsg = merged
        ? `PR #${prResult.prNumber} created and auto-merged. Build is complete.`
        : `PR #${prResult.prNumber} created and awaiting review. ${gateResult.summary}`;

      return {
        success: true,
        message: `${statusMsg}\n\n${prResult.prUrl}`,
        data: {
          prUrl: prResult.prUrl,
          prNumber: prResult.prNumber,
          branchName,
          commitSha: prResult.commitSha,
          merged,
          gates: gateResult,
        },
      };
    }

    // ─── Scheduling & Release Tools ──────────────────────────────────────────

    case "check_deployment_windows": {
      const changeType = String(params.change_type ?? "normal");
      const riskLevel = String(params.risk_level ?? "low");
      const profile = await prisma.businessProfile.findFirst({
        where: { isActive: true },
        include: { deploymentWindows: true, blackoutPeriods: true },
      });

      if (!profile) {
        return { success: true, message: "No business profile configured — deployment is unrestricted. Set up operating hours in Admin to enable deployment windows.", data: { available: true, unrestricted: true } };
      }

      const now = new Date();
      const activeBlackout = profile.blackoutPeriods.find(
        (bp) => bp.startAt <= now && bp.endAt >= now && !bp.exceptions.includes(changeType),
      );
      if (activeBlackout) {
        return {
          success: true,
          message: `Blackout period active until ${activeBlackout.endAt.toISOString()}. Reason: ${activeBlackout.reason ?? "Scheduled blackout"}. Emergency changes may override.`,
          data: { available: false, blackout: true, blackoutEnd: activeBlackout.endAt.toISOString(), reason: activeBlackout.reason },
        };
      }

      const { isNowInWindow } = await import("@/lib/sandbox-promotion");
      const matchingWindows = profile.deploymentWindows.filter(
        (w) => w.allowedChangeTypes.includes(changeType) && w.allowedRiskLevels.includes(riskLevel),
      );

      if (matchingWindows.length === 0) {
        return { success: true, message: "No deployment windows configured for this change type and risk level — deployment is unrestricted.", data: { available: true, unrestricted: true } };
      }

      const windowOpen = isNowInWindow(matchingWindows);
      const windowSummary = matchingWindows.map((w) => ({
        name: w.name,
        days: w.dayOfWeek,
        startTime: w.startTime,
        endTime: w.endTime,
      }));

      return {
        success: true,
        message: windowOpen
          ? `Deployment window is OPEN now. ${matchingWindows.length} matching window(s) available.`
          : `Not in a deployment window. Available windows: ${matchingWindows.map((w) => `${w.name}: days ${w.dayOfWeek.join(",")}, ${w.startTime}-${w.endTime}`).join("; ")}`,
        data: { available: windowOpen, windows: windowSummary },
      };
    }

    case "schedule_promotion": {
      const promotionId = String(params.promotion_id ?? "");
      if (!promotionId) return { success: false, error: "promotion_id is required.", message: "Provide a promotion ID." };

      const promotion = await prisma.changePromotion.findUnique({
        where: { promotionId },
        include: {
          changeItem: { include: { changeRequest: true } },
          productVersion: { include: { featureBuild: { select: { buildId: true } } } },
        },
      });
      if (!promotion) return { success: false, error: "Promotion not found.", message: `No promotion with ID ${promotionId}.` };
      if (promotion.status !== "approved") return { success: false, error: "Promotion must be approved first.", message: `Current status: ${promotion.status}` };

      // Find next available window
      const profile = await prisma.businessProfile.findFirst({
        where: { isActive: true },
        include: { deploymentWindows: true },
      });

      if (!profile || profile.deploymentWindows.length === 0) {
        return { success: true, message: "No deployment windows configured. Promotion can be deployed anytime via Operations > Promotions.", data: { scheduled: false } };
      }

      const rfcType = promotion.changeItem?.changeRequest?.type ?? "normal";
      const riskLevel = promotion.changeItem?.changeRequest?.riskLevel ?? "low";
      const matchingWindows = profile.deploymentWindows.filter(
        (w) => w.allowedChangeTypes.includes(rfcType) && w.allowedRiskLevels.includes(riskLevel),
      );

      if (matchingWindows.length === 0) {
        return { success: true, message: "No windows match this change type and risk level. Ask an admin to configure appropriate deployment windows.", data: { scheduled: false } };
      }

      // Update RFC with deployment window info
      const rfc = promotion.changeItem?.changeRequest;
      if (rfc) {
        await prisma.changeRequest.update({
          where: { id: rfc.id },
          data: {
            status: "scheduled",
            scheduledAt: new Date(),
            deploymentWindowId: matchingWindows[0]!.id,
          },
        });
      }

      const windowDesc = matchingWindows.map((w) => `${w.name}: days ${w.dayOfWeek.join(",")}, ${w.startTime}-${w.endTime}`).join("; ");

      // Persist the scheduled state on the ChangePromotion so getBuildFlowState
      // reads it without peeking at ChangeRequest. deploymentLog carries the
      // window description so the fork can render "Scheduled for <window>".
      await prisma.changePromotion.update({
        where: { promotionId },
        data: { status: "scheduled", deploymentLog: `window: ${windowDesc}` },
      }).catch(() => {});

      logBuildActivity(promotionId, "schedule_promotion", `Scheduled for window: ${windowDesc}`);

      const scheduleBuildId = promotion.productVersion?.featureBuild?.buildId ?? null;
      if (scheduleBuildId) {
        const { reconcileBuildCompletion } = await import("@/lib/build-flow-state");
        await reconcileBuildCompletion(scheduleBuildId).catch(() => {});
      }

      return {
        success: true,
        message: `Promotion ${promotionId} scheduled. Deployment windows: ${windowDesc}. An operator can deploy via Operations > Promotions during an open window.`,
        data: { scheduled: true, windows: windowDesc },
      };
    }

    case "execute_promotion": {
      const promotionId = String(params.promotion_id ?? "");
      const overrideReason = params.override_reason ? String(params.override_reason) : undefined;
      if (!promotionId || !/^[a-zA-Z0-9_-]+$/.test(promotionId)) {
        return { success: false, error: "Invalid promotion_id", message: "Provide a valid promotion ID." };
      }

      // Validate promotion exists and is approved
      const promo = await prisma.changePromotion.findFirst({ where: { promotionId } });
      if (!promo) return { success: false, error: "Not found", message: `Promotion ${promotionId} not found.` };
      if (promo.status === "deployed") return { success: true, message: "Already deployed.", data: { status: "deployed" } };
      if (promo.status !== "approved") return { success: false, error: `Status is ${promo.status}`, message: "Must be approved first." };

      // Enforce deployment window — block execution outside windows unless emergency override
      if (!overrideReason) {
        const { getPromotionWindowStatus } = await import("@/lib/actions/promotions");
        const windowStatus = await getPromotionWindowStatus(promotionId);
        if (!windowStatus.available) {
          return {
            success: false,
            error: "Outside deployment window",
            message: `${windowStatus.message} Use schedule_promotion to queue for the next window, or provide override_reason for emergency deployment.`,
          };
        }
      }

      // Resolve sandbox and build ID
      const promoDetail = await prisma.changePromotion.findFirst({
        where: { promotionId },
        include: { productVersion: { include: { featureBuild: { select: { sandboxId: true, buildId: true } } } } },
      });
      const sandboxId = promoDetail?.productVersion?.featureBuild?.sandboxId;
      const promoBuildId = promoDetail?.productVersion?.featureBuild?.buildId;
      if (!sandboxId) return { success: false, error: "No sandbox", message: "No sandbox linked to this promotion." };

      const { execFile: execFileCb } = lazyChildProcess();
      const { promisify } = lazyUtil();
      const execFileAsync = promisify(execFileCb);
      const execAsync = promisify((lazyChildProcess()).exec);

      // Preflight: the promoter image has to exist locally for `docker run
      // dpf-promoter` to work. On most installs today it doesn't — the image
      // is built separately and isn't on the default compose path. Detect
      // that up front and hand off to the operator UI instead of attempting
      // the run and returning a scary "Could not start the promoter
      // container." message. The promotion stays approved; the operator
      // triggers it from Operations > Promotions.
      try {
        await execAsync("docker image inspect dpf-promoter");
      } catch {
        // Persist the awaiting_operator state so getBuildFlowState reads it
        // from the ChangePromotion column directly (no BuildActivity detour)
        // and the reconciler can treat the fork as dispositioned. The prior
        // version returned awaiting_operator only in the tool response, which
        // the fork state machine couldn't see.
        await prisma.changePromotion.update({
          where: { promotionId },
          data: { status: "awaiting_operator" },
        }).catch(() => {});
        logBuildActivity(promoBuildId ?? promotionId, "execute_promotion", "Promoter image not present — handing off to operator");
        if (promoBuildId) {
          const { reconcileBuildCompletion } = await import("@/lib/build-flow-state");
          await reconcileBuildCompletion(promoBuildId).catch(() => {});
        }
        return {
          success: true,
          message: `Promotion ${promotionId} is approved and ready. This install doesn't have the "dpf-promoter" container image built locally, so automatic deployment is disabled here. An operator needs to run the promotion manually from Operations > Promotions, which will stream the deployment log and handle rollback. The promotion stays in "awaiting_operator" status until then.`,
          data: { status: "awaiting_operator", reason: "promoter_image_missing", promotionId },
        };
      }

      // Start promoter container (array form — no shell injection)
      try {
        await execAsync("docker rm dpf-promoter-1 2>/dev/null || true");
        const dockerArgs = [
          "run", "-d",
          "--name", "dpf-promoter-1",
          "--network", `${process.env.DPF_COMPOSE_PROJECT ?? "dpf"}_default`,
          "-v", "/var/run/docker.sock:/var/run/docker.sock",
          "-v", "dpf_backups:/backups",
          "-e", `PROMOTION_ID=${promotionId}`,
          "-e", `DPF_PRODUCTION_DB_CONTAINER=${process.env.DPF_PRODUCTION_DB_CONTAINER ?? "dpf-postgres-1"}`,
          "-e", "DPF_PORTAL_CONTAINER=dpf-portal-1",
          "-e", `DPF_COMPOSE_PROJECT=${process.env.DPF_COMPOSE_PROJECT ?? "dpf"}`,
          "-e", `DPF_SANDBOX_CONTAINER=${sandboxId}`,
          "-e", `POSTGRES_USER=${process.env.POSTGRES_USER ?? "dpf"}`,
        ];
        if (overrideReason) {
          dockerArgs.push("-e", `DPF_WINDOW_OVERRIDE=${overrideReason}`);
        }
        dockerArgs.push("dpf-promoter");
        await execFileAsync("docker", dockerArgs);
      } catch (err) {
        return {
          success: false,
          error: `Failed to start promoter: ${(err as Error).message?.slice(0, 200)}`,
          message: `Could not start the promoter container. An operator can run this promotion manually from Operations > Promotions — the promotion stays in "approved" status until deployed.`,
        };
      }

      // Poll for completion (max 10 minutes)
      const maxWaitMs = 10 * 60 * 1000;
      const pollIntervalMs = 10_000;
      const startTime = Date.now();
      let exitCode: number | null = null;

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise(r => setTimeout(r, pollIntervalMs));
        try {
          const { stdout } = await execAsync("docker inspect dpf-promoter-1 --format='{{.State.Status}} {{.State.ExitCode}}'");
          const parts = stdout.trim().replace(/'/g, "").split(" ");
          if (parts[0] === "exited") {
            exitCode = parseInt(parts[1] ?? "1", 10);
            break;
          }
        } catch { /* container may not exist yet */ }
      }

      if (exitCode === null) {
        await execAsync("docker stop dpf-promoter-1 2>/dev/null || true").catch(() => {});
        return { success: false, error: "Timeout (10 min)", message: "Promoter did not complete. Check ops dashboard." };
      }

      const finalPromo = await prisma.changePromotion.findFirst({ where: { promotionId } });
      const promoSuccess = exitCode === 0 && finalPromo?.status === "deployed";

      await execAsync("docker rm dpf-promoter-1 2>/dev/null || true").catch(() => {});
      logBuildActivity(promoBuildId ?? promotionId, "execute_promotion", promoSuccess ? "Deployed successfully" : `Rolled back: ${finalPromo?.rollbackReason ?? "unknown"}`);

      if (promoBuildId) {
        const { reconcileBuildCompletion } = await import("@/lib/build-flow-state");
        await reconcileBuildCompletion(promoBuildId).catch(() => {});
      }

      return {
        success: promoSuccess,
        message: promoSuccess
          ? `Promotion ${promotionId} deployed. Health check passed.`
          : `Rolled back. ${finalPromo?.rollbackReason ?? "Check deployment log."}`,
        data: { promotionId, status: finalPromo?.status, deploymentLog: finalPromo?.deploymentLog?.slice(0, 1000) },
      };
    }

    case "create_release_bundle": {
      const title = String(params.title ?? "");
      const buildIds = Array.isArray(params.build_ids) ? params.build_ids.map(String) : [];
      if (!title) return { success: false, error: "title is required.", message: "Provide a release bundle title." };
      if (buildIds.length === 0) return { success: false, error: "build_ids is required.", message: "Provide at least one build ID." };

      // Validate all builds exist and are in review/complete phase
      const builds = await prisma.featureBuild.findMany({
        where: { buildId: { in: buildIds } },
        select: { buildId: true, title: true, phase: true, releaseBundleId: true },
      });
      const missing = buildIds.filter((id) => !builds.some((b) => b.buildId === id));
      if (missing.length > 0) return { success: false, error: `Builds not found: ${missing.join(", ")}`, message: `Could not find builds: ${missing.join(", ")}` };

      const notReady = builds.filter((b) => !["review", "complete", "ship"].includes(b.phase));
      if (notReady.length > 0) {
        return { success: false, error: `Builds not ready: ${notReady.map((b) => `${b.buildId} (${b.phase})`).join(", ")}`, message: `All builds must be in review or complete phase.` };
      }

      const alreadyBundled = builds.filter((b) => b.releaseBundleId);
      if (alreadyBundled.length > 0) {
        return { success: false, error: `Builds already in a bundle: ${alreadyBundled.map((b) => b.buildId).join(", ")}`, message: `Remove from existing bundle first.` };
      }

      // Create the bundle
      const bundleId = `RB-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const bundle = await prisma.releaseBundle.create({
        data: {
          bundleId,
          title,
          status: "assembling",
          createdBy: userId,
        },
      });

      // Link builds to the bundle
      await prisma.featureBuild.updateMany({
        where: { buildId: { in: buildIds } },
        data: { releaseBundleId: bundle.id },
      });

      return {
        success: true,
        message: `Release bundle ${bundleId} created with ${buildIds.length} build(s): ${builds.map((b) => b.title).join(", ")}. Run gate checks before scheduling deployment.`,
        data: { bundleId, title, buildCount: buildIds.length, builds: builds.map((b) => ({ buildId: b.buildId, title: b.title })) },
      };
    }

    case "run_release_gate": {
      const bundleId = String(params.bundle_id ?? "");
      if (!bundleId) return { success: false, error: "bundle_id is required.", message: "Provide a release bundle ID." };

      const bundle = await prisma.releaseBundle.findUnique({
        where: { bundleId },
        include: {
          builds: {
            select: {
              buildId: true, title: true, phase: true, diffPatch: true,
              verificationOut: true, sandboxId: true,
            },
          },
        },
      });
      if (!bundle) return { success: false, error: "Bundle not found.", message: `No release bundle with ID ${bundleId}.` };
      if (bundle.status !== "assembling") {
        return { success: false, error: `Gate check already run. Bundle status: ${bundle.status}`, message: `Bundle is in ${bundle.status} state.` };
      }
      if (bundle.builds.length === 0) {
        return { success: false, error: "Bundle has no builds.", message: "Add builds to the bundle first." };
      }

      // Check all builds are in review/complete/ship phase
      const notReady = bundle.builds.filter((b) => !["review", "complete", "ship"].includes(b.phase));
      if (notReady.length > 0) {
        return {
          success: false, error: `Builds not ready: ${notReady.map((b) => `${b.buildId} (${b.phase})`).join(", ")}`,
          message: "All builds must be in review or complete phase.",
        };
      }

      // Check all builds have passing tests
      const failedTests = bundle.builds.filter((b) => {
        const v = b.verificationOut as Record<string, unknown> | null;
        return v && (v.testsPassed === false || v.testsPassed === 0);
      });

      // Combine diffs from all builds
      const diffs: string[] = [];
      for (const build of bundle.builds) {
        if (build.diffPatch) {
          diffs.push(build.diffPatch as string);
        } else if (build.sandboxId) {
          try {
            const { extractDiff } = await import("@/lib/sandbox");
            const diff = await extractDiff(build.sandboxId);
            diffs.push(diff);
          } catch {
            // Build has no extractable diff — may be fine if it's code-only
          }
        }
      }

      const combinedDiff = diffs.join("\n");

      // Scan for destructive operations
      const { scanForDestructiveOps, categorizeDiffFiles } = await import("@/lib/sandbox-promotion");
      const allFileMatches = [...combinedDiff.matchAll(/^diff --git a\/(.+) b\/.+$/gm)].map((m) => m[1]);
      const { migrationFiles } = categorizeDiffFiles(allFileMatches);
      const destructiveWarnings = migrationFiles.length > 0 ? scanForDestructiveOps(combinedDiff) : [];

      // Build gate check result
      const gateResult = {
        buildsChecked: bundle.builds.length,
        allTestsPass: failedTests.length === 0,
        failedTestBuilds: failedTests.map((b) => b.buildId),
        totalFilesChanged: allFileMatches.length,
        migrationFiles: migrationFiles.length,
        destructiveWarnings,
        combinedDiffLength: combinedDiff.length,
      };

      const passed = failedTests.length === 0 && destructiveWarnings.length === 0;

      // Update bundle
      await prisma.releaseBundle.update({
        where: { bundleId },
        data: {
          status: passed ? "approved" : "gate_check",
          combinedDiffPatch: combinedDiff,
          gateCheckResult: gateResult as unknown as import("@dpf/db").Prisma.InputJsonValue,
        },
      });

      const messageParts = [
        `Gate check ${passed ? "PASSED" : "FAILED"} for ${bundleId}.`,
        `${bundle.builds.length} build(s), ${allFileMatches.length} file(s) changed, ${migrationFiles.length} migration(s).`,
      ];
      if (failedTests.length > 0) messageParts.push(`Failing tests in: ${failedTests.map((b) => b.buildId).join(", ")}.`);
      if (destructiveWarnings.length > 0) messageParts.push(`Destructive ops: ${destructiveWarnings.join("; ")}`);
      if (passed) messageParts.push("Bundle is approved and ready to schedule for deployment.");

      return { success: true, message: messageParts.join(" "), data: gateResult };
    }

    case "schedule_release_bundle": {
      const bundleId = String(params.bundle_id ?? "");
      if (!bundleId) return { success: false, error: "bundle_id is required.", message: "Provide a release bundle ID." };

      const bundle = await prisma.releaseBundle.findUnique({
        where: { bundleId },
        include: { builds: { select: { buildId: true, title: true, createdById: true } } },
      });
      if (!bundle) return { success: false, error: "Bundle not found.", message: `No bundle ${bundleId}.` };
      if (bundle.status !== "approved") {
        return { success: false, error: `Bundle must be approved first. Current: ${bundle.status}`, message: `Run gate checks first.` };
      }

      // Find next available deployment window
      const profile = await prisma.businessProfile.findFirst({
        where: { isActive: true },
        include: { deploymentWindows: true },
      });

      const matchingWindows = profile?.deploymentWindows.filter(
        (w) => w.allowedChangeTypes.includes("normal") && w.allowedRiskLevels.includes("low"),
      ) ?? [];

      // Create RFC for the bundle
      const rfcId = `RFC-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const rfc = await prisma.changeRequest.create({
        data: {
          rfcId,
          title: `Release: ${bundle.title}`,
          description: `Release bundle ${bundleId} with ${bundle.builds.length} build(s): ${bundle.builds.map((b) => b.title).join(", ")}`,
          type: "normal",
          scope: "platform",
          riskLevel: "low",
          status: "scheduled",
          scheduledAt: new Date(),
          requestedById: bundle.createdBy,
          ...(matchingWindows.length > 0 ? { deploymentWindowId: matchingWindows[0]!.id } : {}),
        },
      });

      // Create CalendarEvent for visibility
      const employee = await prisma.employeeProfile.findFirst({
        where: { userId: bundle.createdBy },
        select: { id: true },
      });

      let calendarEventId: string | undefined;
      if (employee) {
        const eventId = `RELEASE-${bundleId}`;
        await prisma.calendarEvent.upsert({
          where: { eventId },
          create: {
            eventId,
            title: `Deployment: ${bundle.title}`,
            description: `${bundle.builds.length} feature(s): ${bundle.builds.map((b) => b.title).join(", ")}`,
            startAt: new Date(),
            eventType: "action",
            category: "platform",
            ownerEmployeeId: employee.id,
            visibility: "team",
            color: "#f59e0b",
          },
          update: { title: `Deployment: ${bundle.title}`, startAt: new Date() },
        });
        calendarEventId = eventId;
      }

      // Update bundle
      await prisma.releaseBundle.update({
        where: { bundleId },
        data: {
          status: "scheduled",
          rfcId: rfc.rfcId,
          calendarEventId,
          scheduledAt: new Date(),
          ...(matchingWindows.length > 0 ? { deploymentWindowId: matchingWindows[0]!.id } : {}),
        },
      });

      const windowDesc = matchingWindows.length > 0
        ? matchingWindows.map((w) => `${w.name}: days ${w.dayOfWeek.join(",")}, ${w.startTime}-${w.endTime}`).join("; ")
        : "No windows configured — deployment unrestricted";

      return {
        success: true,
        message: `Release ${bundleId} scheduled. RFC: ${rfcId}. Added to operations calendar. Windows: ${windowDesc}. An operator can deploy via Operations > Promotions.`,
        data: { bundleId, rfcId, calendarEventId, windows: windowDesc },
      };
    }

    case "get_release_status": {
      const bundleId = params.bundle_id ? String(params.bundle_id) : null;
      const promotionId = params.promotion_id ? String(params.promotion_id) : null;

      if (bundleId) {
        const bundle = await prisma.releaseBundle.findUnique({
          where: { bundleId },
          include: { builds: { select: { buildId: true, title: true, phase: true } } },
        });
        if (!bundle) return { success: false, error: "Bundle not found.", message: `No release bundle with ID ${bundleId}.` };
        return {
          success: true,
          message: `Release ${bundle.bundleId}: ${bundle.status}. ${bundle.builds.length} build(s).`,
          data: {
            bundleId: bundle.bundleId,
            title: bundle.title,
            status: bundle.status,
            builds: bundle.builds,
            scheduledAt: bundle.scheduledAt?.toISOString() ?? null,
            deployedAt: bundle.deployedAt?.toISOString() ?? null,
          },
        };
      }

      if (promotionId) {
        const { getPromotionWindowStatus } = await import("@/lib/actions/promotions");
        const windowStatus = await getPromotionWindowStatus(promotionId).catch(() => ({ available: false, message: "Could not check window status" }));
        const promotion = await prisma.changePromotion.findUnique({
          where: { promotionId },
          select: { status: true, deployedAt: true, rationale: true, rollbackReason: true },
        });
        if (!promotion) return { success: false, error: "Promotion not found.", message: `No promotion with ID ${promotionId}.` };
        return {
          success: true,
          message: `Promotion ${promotionId}: ${promotion.status}. Window: ${windowStatus.message}`,
          data: { promotionId, ...promotion, windowStatus },
        };
      }

      return { success: false, error: "Provide bundle_id or promotion_id.", message: "Specify which release or promotion to check." };
    }

    // ─── Hive Mind Contribution ──────────────────────────────────────────────

    // assess_contribution case moved to mcp/packs/contribution-hive-pack.ts

    case "set_change_disposition": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const disposition = (params.disposition as string) ?? "";
      if (disposition !== "private" && disposition !== "shareable") {
        return { success: false, error: "Invalid disposition.", message: "disposition must be 'private' or 'shareable'." };
      }
      const reason = typeof params.reason === "string" ? params.reason : null;
      await prisma.featureBuild.update({
        where: { buildId },
        data: {
          disposition,
          dispositionReason: reason,
          dispositionSource: "operator",
          dispositionDecidedAt: new Date(),
          dispositionDecidedById: userId,
        },
      });
      logBuildActivity(buildId, "set_change_disposition", `disposition=${disposition}${reason ? ` (${reason})` : ""}`);
      return {
        success: true,
        message: disposition === "shareable"
          ? "This change is marked to share with the community. Run contribute_to_hive (or create the portal PR) to share it."
          : "This change is kept on your system and will not be shared.",
      };
    }

    // contribute_to_hive case moved to mcp/packs/contribution-hive-pack.ts

    case "run_ux_test": {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true, sandboxPort: true, brief: true, kind: true } });
      if (!build?.sandboxPort || !build.sandboxId || !build.brief) return { success: false, error: "Sandbox or brief not ready.", message: "Launch sandbox and save brief first." };

      const { deriveFixUxTestCases } = await import("@/lib/explore/feature-build-types");
      const brief = build.brief as {
        acceptanceCriteria?: string[];
        fixContext?: import("@/lib/explore/feature-build-types").FixContext;
      };
      // Explicit `tests` always win. Otherwise, for a fix build derive the
      // assertion from the structured fix diagnosis (defect-gone on its route)
      // rather than the polluted feature acceptanceCriteria. (BI-AC5CFDB0)
      const testCases =
        (params.tests as string[] | undefined) ??
        (build.kind === "fix"
          ? deriveFixUxTestCases(brief.fixContext)
          : brief.acceptanceCriteria ?? []);
      if (testCases.length === 0) return { success: false, error: "No test cases.", message: build.kind === "fix" ? "No fix context (route/expected) or test cases to verify." : "No acceptance criteria or test cases to run." };

      try {
        const BROWSER_USE_URL = process.env.BROWSER_USE_URL || "http://browser-use:8500/mcp";
        // browser-use runs inside the docker compose network — use the
        // internal service URL (http://sandbox:3000), not the host port,
        // so assets and API calls resolve correctly.
        const { resolveSandboxUrl } = await import("@/lib/integrate/sandbox/resolve-sandbox-url");
        const sandboxUrl = resolveSandboxUrl(build.sandboxId, build.sandboxPort).internal;

        const testRes = await fetch(BROWSER_USE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "browse_run_tests",
              arguments: {
                url: sandboxUrl,
                tests: testCases,
                // Scope per-step screenshots to a build-specific subdir on
                // the shared /evidence volume. Portal serves them through
                // /api/build/<buildId>/evidence/<file>.png.
                evidence_dir: `build_${buildId}`,
              },
            },
          }),
          signal: AbortSignal.timeout(300000), // 5 min for full test suite
        });
        const testResult = await testRes.json();
        const testContent = JSON.parse(testResult?.result?.content?.[0]?.text ?? "{}");

        // Convert to UxTestStep format for storage. screenshot_path (when
        // present) is a filename inside the evidence_dir — turn it into a
        // portal-served URL the ReviewPanel can render.
        const steps = (testContent.results ?? []).map((r: Record<string, unknown>, i: number) => ({
          step: (r.test as string) ?? `Test ${i + 1}`,
          passed: r.status === "pass",
          screenshotUrl: typeof r.screenshot_path === "string"
            ? `/api/build/${encodeURIComponent(buildId)}/evidence/${encodeURIComponent(r.screenshot_path)}`
            : null,
          error: r.status !== "pass" ? ((r.detail as string) ?? null) : null,
        }));

        const { agentEventBus } = await import("@/lib/agent-event-bus");
        for (let i = 0; i < steps.length; i++) {
          if (context?.threadId) {
            agentEventBus.emit(context.threadId, {
              type: "test:step",
              stepIndex: i,
              description: steps[i]!.step,
              passed: steps[i]!.passed,
            });
          }
        }
        const { saveBuildArtifactRevision } = await import("@/lib/build/build-artifact-provenance");
        await saveBuildArtifactRevision({
          buildId,
          field: "uxTestResults",
          savedByAgentId: context?.agentId ?? null,
          savedByUserId: userId,
          threadId: context?.threadId ?? null,
          value: steps,
        });
        if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "uxTestResults" });
        const passed = steps.filter((s: { passed: boolean }) => s.passed).length;
        logBuildActivity(buildId, "run_ux_test", `UX tests: ${passed}/${steps.length} passed (browser-use).`);
        return {
          success: true,
          message: `UX tests: ${passed}/${steps.length} passed.`,
          data: { buildId, steps, browserUseResults: testContent },
        };
      } catch (err) {
        const msg = (err as Error).message?.slice(0, 200) ?? "Unknown error";
        return { success: false, error: `UX test run failed: ${msg}`, message: `UX verification service (browser-use) is unreachable. Run 'docker compose up -d browser-use' or check the browser-use container logs. You can skip UX tests and proceed with the review if you have to.` };
      }
    }

    case "start_ideate_research": {
      // This tool is a signal — the actual research dispatch happens in
      // agent-coworker.ts after the agentic loop returns. We just persist
      // the user context so the dispatch knows what to research.
      const scope = String(params.reusabilityScope ?? "parameterizable");
      const userCtx = String(params.userContext ?? "");

      // BI-F4A30FCB (Dale dogfood 2026-05-24): resolve the target build
      // from agent context first. The previous "findFirst by phase=ideate
      // ordered by updatedAt" silently mis-targeted whenever multiple
      // builds were in ideate concurrently — the user's request landed on
      // an unrelated build whose updatedAt happened to be newer.
      // An explicit buildId param wins over the ambient conversation context:
      // it lets an operator/agent drive a chosen build's research even when
      // several builds are in-flight (autonomous batch). When omitted, the
      // exact prior ambient-resolution behavior is preserved.
      const activeBuild = await resolveIdeateBuildForTool({
        contextBuildId: extractBuildIdHint(params) ?? context?.featureBuildId,
        toolName: "start_ideate_research",
      });
      if (!activeBuild.build) {
        return activeBuild.refusal;
      }

      await prisma.featureBuild.update({
        where: { buildId: activeBuild.build.buildId },
        data: {
          buildExecState: {
            ideateResearchRequested: true,
            reusabilityScope: scope,
            userContext: userCtx,
            requestedAt: new Date().toISOString(),
          },
        },
      });

      return {
        success: true,
        message: "Research started. Searching the codebase and drafting the design document — this takes about 1-2 minutes. Tell the user you're researching now. IMPORTANT: Do NOT call saveBuildEvidence with field 'designDoc' — the research system saves the design document and runs the review automatically when research completes. Just wait and tell the user.",
        data: { reusabilityScope: scope, userContext: userCtx, buildId: activeBuild.build.buildId },
      };
    }

    case "start_scout_research": {
      // Scout dispatch: similar to ideate research, but runs a fast parallel search + URL fetch
      const externalUrls = (params.externalUrls as string[] | undefined) ?? [];

      // BI-F4A30FCB (Dale dogfood 2026-05-24): resolve the target build
      // from agent context first; see start_ideate_research comment above.
      // BI-7FEAFD9A (2026-07-05): prefer the FB- hint from params.buildId
      // (set by the executeTool preamble from the context cuid) — passing the
      // raw context.featureBuildId cuid here made the resolver's
      // where:{buildId} lookup a guaranteed miss, so scout always refused.
      const resolved = await resolveIdeateBuildForTool({
        contextBuildId: extractBuildIdHint(params) ?? context?.featureBuildId,
        toolName: "start_scout_research",
      });
      if (!resolved.build) {
        return resolved.refusal;
      }
      const activeBuild = await prisma.featureBuild.findUnique({
        where: { buildId: resolved.build.buildId },
        select: { buildId: true, buildExecState: true, scoutFindings: true },
      });
      if (!activeBuild) {
        return { success: false, message: "Active ideate build vanished between resolve and read — try again." };
      }

      const current = activeBuild.buildExecState as Record<string, unknown> | null;

      // Idempotency: if scout has already delivered findings, do NOT re-run.
      // The agentic loop otherwise re-calls this tool every iteration because
      // the initial response says "results will appear on the next turn" and
      // the model doesn't see the findings in its prompt context. The stuck-
      // detector eventually bails, but not before burning 4-5 iterations and
      // preventing phase advance. Tell the agent plainly the work is done.
      if (activeBuild.scoutFindings !== null && activeBuild.scoutFindings !== undefined) {
        return {
          success: true,
          message:
            "Scout already ran for this build. Findings are saved to Build Studio Context — proceed with ideate using the existing scout results; do NOT call start_scout_research again.",
          data: { alreadyComplete: true },
        };
      }

      // Idempotency: if a scout request is already pending dispatch (flag set
      // by a prior call but not yet cleared by the coworker post-turn hook),
      // don't stack up another request. Same guidance.
      if (current?.scoutResearchRequested === true) {
        return {
          success: true,
          message:
            "Scout already requested and is running now. Wait for the next turn to see findings — do NOT call start_scout_research again.",
          data: { alreadyRequested: true },
        };
      }

      await prisma.featureBuild.update({
        where: { buildId: activeBuild.buildId },
        data: {
          buildExecState: {
            ...(current ?? {}),
            scoutResearchRequested: true,
            scoutUrls: externalUrls,
            scoutRequestedAt: new Date().toISOString(),
          },
        },
      });

      return {
        success: true,
        message: "Scout started. Codebase search and URL parsing running in background — takes about 30 seconds. Results will appear in your Build Studio Context on the next turn. Do NOT call start_scout_research again; wait for the results.",
        data: { urlCount: externalUrls.length },
      };
    }

    // ─── Design Intelligence Tools (UI UX Pro Max) ──────────────────────────
    case "propose_file_change": {
      const { readProjectFile, writeProjectFile, generateSimpleDiff } = await import("./integrate/codebase-tools");
      const path = String(params.path ?? "");
      const newContent = String(params.newContent ?? "");
      const description = String(params.description ?? "");

      const current = await readProjectFile(path);
      const currentContent = "content" in current ? current.content : "";
      const diff = generateSimpleDiff(currentContent, newContent, path);

      const writeResult = await writeProjectFile(path, newContent);
      if ("error" in writeResult) return { success: false, error: writeResult.error, message: writeResult.error };

      // Auto-commit the approved change
      let commitHash: string | undefined;
      try {
        const { commitFile, formatCommitMessage, isGitAvailable } = await import("@/lib/git-utils");
        if (await isGitAvailable()) {
          // Resolve buildId from thread context (best-effort)
          let buildId: string | undefined;
          if (context?.threadId) {
            const build = await prisma.featureBuild.findFirst({
              where: { threadId: context.threadId, phase: { in: ["build", "review"] } },
              select: { buildId: true, id: true },
            });
            if (build) buildId = build.buildId;
          }

          const message = formatCommitMessage({ description, filePath: path, ...(buildId ? { buildId } : {}), approvedBy: userId });
          const result = await commitFile({ filePath: path, message });

          if ("hash" in result) {
            commitHash = result.hash;

            // Update AgentActionProposal with commit hash (best-effort)
            if (context?.threadId) {
              await prisma.agentActionProposal.updateMany({
                where: { threadId: context.threadId, actionType: "propose_file_change", status: "approved", gitCommitHash: null },
                data: { gitCommitHash: commitHash },
              }).catch(() => {});
            }

            // Append commit hash to FeatureBuild (best-effort)
            if (buildId) {
              await prisma.featureBuild.update({
                where: { buildId },
                data: { gitCommitHashes: { push: commitHash } },
              }).catch(() => {});
            }
          } else {
            console.warn("[propose_file_change] git commit failed: %s", JSON.stringify(result.error));
          }
        }
      } catch (err) {
        console.warn("[propose_file_change] auto-commit error:", err);
      }

      return {
        success: true,
        entityId: path,
        message: commitHash ? `Applied and committed: ${path}` : `Applied change to ${path}`,
        data: { path, diff, description, ...(commitHash ? { commitHash } : {}) },
      };
    }

    // propose_improvement case moved to mcp/packs/contribution-hive-pack.ts

    // propose_skill_improvement case moved to mcp/packs/contribution-hive-pack.ts

    // submit_feedback case moved to mcp/packs/contribution-hive-pack.ts

    case "principle_decide": {
      // Phase 2 Task 2.7. Pulls in-scope commandments from Postgres (always
      // applied) and relevant core/contextual principles from Qdrant, then
      // runs the pure decide() math. Returns a contribution ledger so
      // callers can render the why, not just the what.
      const validPopulations = new Set([
        "in_platform_coworker",
        "external_coding_agent",
        "human",
      ]);
      const callingPopulation = params["callingPopulation"];
      if (
        typeof callingPopulation !== "string" ||
        !validPopulations.has(callingPopulation)
      ) {
        return {
          success: false,
          message:
            "callingPopulation must be one of: in_platform_coworker, external_coding_agent, human.",
          error: "Invalid callingPopulation",
        };
      }
      const optionsParam = params["options"];
      if (!Array.isArray(optionsParam) || optionsParam.length === 0) {
        return {
          success: false,
          message: "options must be a non-empty array.",
          error: "Empty options",
        };
      }

      const { listPrinciplesByTier, prisma, PRINCIPLE_DECIDE_DEFAULTS } =
        await import("@dpf/db");
      const { PRINCIPLE_RING_SCOPES } = await import(
        "@dpf/db/wiki-taxonomy"
      );
      const { searchWikiPages } = await import("@/lib/wiki/embeddings");
      const { decide } = await import("@/lib/wiki/principle-decide");
      const { principleMatchesRingScope } = await import(
        "@/lib/wiki/calling-ring-map"
      );
      // BI-3C1A6451: server-side embedding for the semantic-fallback path.
      // Used both for principle direction text (Qdrant-sourced principles
      // have empty dimensionVector) and for option descriptions when the
      // caller passes empty features. Pre-fix, both produced alignment=0.
      const { generateEmbedding } = await import("@/lib/inference/embedding");

      // Validate ringScope per the closed taxonomy registry. Unknown values
      // fail fast instead of silently degrading to universal — silent skip
      // on bad input is the failure mode `make-silent-failures-observable`
      // (the kernel commandment promoted in PR #1081) forbids.
      let ringScope: string[] | undefined;
      if (params["ringScope"] !== undefined) {
        if (!Array.isArray(params["ringScope"])) {
          return {
            success: false,
            message:
              "ringScope must be an array of values from PRINCIPLE_RING_SCOPES.",
            error: "Invalid ringScope shape",
          };
        }
        const unknown = (params["ringScope"] as unknown[]).filter(
          (v): v is string =>
            typeof v === "string" &&
            !(PRINCIPLE_RING_SCOPES as readonly string[]).includes(v),
        );
        if (unknown.length > 0) {
          return {
            success: false,
            message: `ringScope contains unknown values: ${unknown.join(", ")}. Allowed: ${PRINCIPLE_RING_SCOPES.join(", ")}.`,
            error: "Invalid ringScope value",
          };
        }
        ringScope = params["ringScope"] as string[];
      }
      const ringScopeActive =
        ringScope !== undefined &&
        ringScope.length > 0 &&
        !ringScope.includes("universal-ring");
      const callingSurface =
        typeof params["callingSurface"] === "string"
          ? params["callingSurface"]
          : null;

      const maxPrinciples =
        typeof params["maxPrinciples"] === "number"
          ? params["maxPrinciples"]
          : PRINCIPLE_DECIDE_DEFAULTS.maxPrinciples;
      const tieMargin =
        typeof params["tieMargin"] === "number"
          ? params["tieMargin"]
          : PRINCIPLE_DECIDE_DEFAULTS.tieMargin;
      const contextualThreshold =
        PRINCIPLE_DECIDE_DEFAULTS.contextualSimilarityThreshold;
      const semanticWarnRatio =
        PRINCIPLE_DECIDE_DEFAULTS.semanticFallbackWarnRatio;

      const org = await prisma.organization
        .findFirst({ select: { id: true } })
        .catch(() => null);
      const organizationId: string | null = org?.id ?? null;

      // 1. Commandments from Postgres (full dimension vector). Always applied.
      // limit 50 (not 10): commandments are uncapped doctrine as of 2026-05-22
      // and the comment above claims they are "Always applied" — but there are
      // now 19+ commandment principles, so a limit of 10 silently truncated ~9
      // of them from every decision (ordered by lastReviewedAt/title), letting
      // process commandments crowd out doctrine like architecture-over-shortcuts.
      // 50 matches listPrinciplesByTier's own default and leaves headroom.
      // See docs/superpowers/specs/2026-06-05-situational-aware-decision-weighting-design.md §1 RC4.
      let commandments: Array<Record<string, unknown>> = [];
      try {
        commandments = (await listPrinciplesByTier(prisma, {
          tier: "commandment",
          organizationId,
          appliesTo: callingPopulation,
          ringScope,
          limit: 50,
        })) as Array<Record<string, unknown>>;
      } catch (err) {
        console.warn("[principle_decide] commandment Postgres lookup failed:", err);
      }

      const contextQuery = String(params["context"] ?? "");

      // 2. Core from Qdrant — relevance-ranked.
      let core: Array<Record<string, unknown>> = [];
      try {
        core = (await searchWikiPages({
          query: contextQuery,
          organizationId,
          pageKind: "principle",
          principleTier: "core",
          principleAppliesTo: callingPopulation,
          principleRingScope: ringScopeActive ? ringScope : undefined,
          limit: 5,
        })) as Array<Record<string, unknown>>;
      } catch (err) {
        console.warn("[principle_decide] core Qdrant lookup failed:", err);
      }

      // 3. Contextual from Qdrant — relevance-gated.
      let contextual: Array<Record<string, unknown>> = [];
      try {
        contextual = (await searchWikiPages({
          query: contextQuery,
          organizationId,
          pageKind: "principle",
          principleTier: "contextual",
          principleAppliesTo: callingPopulation,
          principleRingScope: ringScopeActive ? ringScope : undefined,
          limit: 5,
          scoreThreshold: contextualThreshold,
        })) as Array<Record<string, unknown>>;
      } catch (err) {
        console.warn("[principle_decide] contextual Qdrant lookup failed:", err);
      }

      // Post-filter (cheap belt-and-suspenders). Mirrors the contract used
      // by recallPrincipleContext: empty principleRingScope passes
      // (backward-compat); universal-ring always passes; otherwise
      // intersection check. Catches any retrieval path that didn't get
      // the ringScope arg threaded through (e.g. narrow test mocks).
      let commandmentsExcluded = 0;
      let coreExcluded = 0;
      let contextualExcluded = 0;
      if (ringScopeActive && ringScope) {
        const before = { c: commandments.length, k: core.length, x: contextual.length };
        commandments = commandments.filter((row) =>
          principleMatchesRingScope(
            (row["principleRingScope"] as string[] | undefined) ?? [],
            ringScope as never,
          ),
        );
        core = core.filter((row) =>
          principleMatchesRingScope(
            (row["principleRingScope"] as string[] | undefined) ?? [],
            ringScope as never,
          ),
        );
        contextual = contextual.filter((row) =>
          principleMatchesRingScope(
            (row["principleRingScope"] as string[] | undefined) ?? [],
            ringScope as never,
          ),
        );
        commandmentsExcluded = before.c - commandments.length;
        coreExcluded = before.k - core.length;
        contextualExcluded = before.x - contextual.length;
      }

      console.info(
        `[principle-recall-trace] ` +
          JSON.stringify({
            callingSurface,
            callingPopulation,
            ringScope: ringScope ?? null,
            ringScopeActive,
            tool: "principle_decide",
            commandmentCount: commandments.length,
            coreCount: core.length,
            contextualCount: contextual.length,
            ringScopeExcluded: {
              commandments: commandmentsExcluded,
              core: coreExcluded,
              contextual: contextualExcluded,
            },
          }),
      );

      const TIER_DEFAULT_WEIGHT: Record<string, number> = {
        commandment: 1.0,
        core: 0.4,
        contextual: 0.1,
      };
      function resolveWeight(tier: string, override: unknown): number {
        if (typeof override === "number") return override;
        return TIER_DEFAULT_WEIGHT[tier] ?? 0;
      }

      // Build DecisionPrinciple[] from the merged set. Postgres rows carry
      // the full dimensionVector for structured alignment; Qdrant hits only
      // carry dimension keys (no signed vector), so they fall back to
      // semantic alignment. For the semantic path to produce non-zero
      // signal, we must embed each candidate's direction text and let
      // decide()'s cosine math do the rest (BI-3C1A6451 — the dead-code
      // defect tracked at apps/web/lib/wiki/principle-decide.ts:117).
      // PG rows carry direction at row.principleDirection; Qdrant hits
      // carry it at hit.contentPreview.
      type CandidateRow = {
        id: string;
        name: string;
        tier: string;
        weight: number;
        dimensionVector: Record<string, number>;
        directionText: string;
      };
      const candidateRows: CandidateRow[] = [
        ...commandments.map((row): CandidateRow => ({
          id: String(row["id"] ?? ""),
          name: String(row["title"] ?? row["slug"] ?? "principle"),
          tier: String(row["principleTier"] ?? "commandment"),
          weight: resolveWeight(
            String(row["principleTier"] ?? "commandment"),
            row["principleWeight"],
          ),
          dimensionVector:
            (row["principleDimensionVector"] as Record<string, number> | null) ??
            {},
          directionText: String(row["principleDirection"] ?? ""),
        })),
        ...[...core, ...contextual].map((hit): CandidateRow => ({
          id: String(hit["pageId"] ?? ""),
          name: String(hit["title"] ?? hit["slug"] ?? "principle"),
          tier: String(hit["principleTier"] ?? "core"),
          weight: resolveWeight(
            String(hit["principleTier"] ?? "core"),
            undefined,
          ),
          dimensionVector: {}, // Qdrant payload omits the signed vector
          directionText: String(hit["contentPreview"] ?? ""),
        })),
      ];

      // For any candidate that will fall back to semantic alignment
      // (empty dimensionVector), embed its direction text server-side.
      // Parallelized to amortize inference round-trips. Skipped for
      // structured-alignment rows since their embedding wouldn't be used.
      const principleEmbeddings = await Promise.all(
        candidateRows.map(async (row): Promise<number[] | undefined> => {
          if (Object.keys(row.dimensionVector).length > 0) return undefined;
          if (!row.directionText) return undefined;
          const e = await generateEmbedding(row.directionText);
          return e ?? undefined;
        }),
      );

      type DecisionPrinciple = Parameters<typeof decide>[1][number];
      const principleList: DecisionPrinciple[] = candidateRows.map(
        (row, i): DecisionPrinciple => ({
          id: row.id,
          name: row.name,
          tier: row.tier,
          weight: row.weight,
          dimensionVector: row.dimensionVector,
          directionEmbedding: principleEmbeddings[i],
        }),
      );

      const cappedPrinciples = principleList.slice(0, maxPrinciples);

      // Mirror treatment for options: when the caller passes empty features
      // and no explicit embedding, embed the description so the semantic
      // path can actually fire. Caller-supplied embeddings (the rare
      // sophisticated path) win. Per BI-3C1A6451 acceptance criterion.
      type DecisionOption = Parameters<typeof decide>[0][number];
      const decisionOptions: DecisionOption[] = await Promise.all(
        optionsParam
          .filter(
            (o): o is Record<string, unknown> =>
              typeof o === "object" && o !== null,
          )
          .map(async (o): Promise<DecisionOption> => {
            const features =
              typeof o["features"] === "object" && o["features"] !== null
                ? (o["features"] as Record<string, number>)
                : {};
            const description = String(o["description"] ?? "");
            let embedding: number[] | undefined;
            if (Array.isArray(o["embedding"])) {
              embedding = (o["embedding"] as unknown[]).map((n) => Number(n));
            } else if (Object.keys(features).length === 0 && description) {
              const e = await generateEmbedding(description);
              if (e) embedding = e;
            }
            return {
              id: String(o["id"] ?? ""),
              description,
              features,
              embedding,
            };
          }),
      );

      const result = decide(decisionOptions, cappedPrinciples, {
        tieMargin,
        semanticFallbackWarnRatio: semanticWarnRatio,
      });

      // BI-E1FB2307: resolve which decision-perspective profile governs this
      // caller (WWMD platform vs WWWD organization) and name it in the response
      // so agents/operators know which kernel weighed in. Additive — does not
      // change scoring yet; Gate-routed scoring + boundary enforcement is the
      // follow-on (C2b). callingPopulation was validated above.
      const { resolveDecisionCallerContext } = await import(
        "@/lib/decision/caller-context"
      );
      const governingProfile = await resolveDecisionCallerContext({
        callingPopulation:
          callingPopulation as "in_platform_coworker" | "external_coding_agent" | "human",
        agentId: context?.agentId ?? null,
      });

      // When there is no recommendation, result.reasoning names why —
      // insufficient signal (zero contributions, BI-5CE7CF0B) vs no
      // applicable principles vs no options — instead of a one-size message.
      const summary = result.recommendation
        ? `Recommends ${result.recommendation.optionId} (confidence: ${result.recommendation.confidence}, composite ${result.recommendation.composite.toFixed(3)}; governing profile: ${governingProfile.governingProfileKind})`
        : result.reasoning;

      // Persist the consult to the DecisionInteraction ledger so the decision
      // governance hub can audit that the gate is in use (per-tier log at
      // /wiki/decisions). Fail-open: a ledger outage never blocks the
      // decision, but the outcome is named in the response either way.
      // This is audit observability, not a business mutation — the tool's
      // read-only annotation stays as-is (ToolExecution already logs calls;
      // this adds the decision-shaped record the governance surfaces read).
      const { recordKernelConsultInteraction } = await import(
        "@/lib/decision/kernel-consult-ledger"
      );
      const ledger = await recordKernelConsultInteraction({
        db: prisma,
        result,
        callerContext: governingProfile,
        question: contextQuery,
        optionIds: decisionOptions.map((o) => o.id),
        optionDescriptions: Object.fromEntries(
          decisionOptions.map((o) => [o.id, o.description]),
        ),
        appliedPrincipleCount: cappedPrinciples.length,
        callingSurface,
        routeContext: context?.routeContext ?? null,
        taskRunId: context?.taskRunId ?? null,
        caller: {
          client: context?.callerClient ?? null,
          apiTokenId: context?.apiTokenId ?? null,
          authSource: context?.authSource ?? null,
          agentId: context?.agentId ?? null,
          threadId: context?.threadId ?? null,
        },
      });

      return {
        success: true,
        message: summary,
        data: {
          recommendation: result.recommendation,
          scores: result.scores,
          flags: result.flags,
          reasoning: result.reasoning,
          appliedPrincipleCount: cappedPrinciples.length,
          governingProfile: {
            profileId: governingProfile.governingProfileId,
            kind: governingProfile.governingProfileKind,
            resolvedVia: governingProfile.resolvedVia,
          },
          ledger,
        },
      };
    }

    case "run_endpoint_tests": {
      const { runEndpointTests } = await import("@/lib/endpoint-test-runner");
      const request = buildEndpointTestRunRequest(params, context);

      if (request.error) {
        return { success: false, message: request.error };
      }

      const modelId = request.modelId ?? (
        request.endpointId && !request.allModels
          ? await resolveRepresentativeEndpointModelId(request.endpointId)
          : undefined
      );

      const results = await runEndpointTests({
        ...(request.endpointId ? { endpointId: request.endpointId } : {}),
        ...(modelId ? { modelId } : {}),
        ...(request.taskType ? { taskType: request.taskType } : {}),
        probesOnly: request.probesOnly,
        triggeredBy: userId,
      });

      const summary = results.map((r) => {
        const probesPassed = r.probes.filter((p) => p.pass).length;
        const probesFailed = r.probes.filter((p) => !p.pass).length;
        const scenariosPassed = r.scenarios.filter((s) => s.passed).length;
        const scenariosFailed = r.scenarios.filter((s) => !s.passed).length;
        const lines = [
          `**${r.endpointId}**: Probes ${probesPassed}/${probesPassed + probesFailed} passed`,
        ];
        if (r.scenarios.length > 0) {
          lines.push(`Scenarios ${scenariosPassed}/${scenariosPassed + scenariosFailed} passed`);
        }
        lines.push(`Instruction following: ${r.instructionFollowing ?? "unknown"}`);
        if (r.codingCapability) lines.push(`Coding: ${r.codingCapability}`);
        // List failures
        for (const p of r.probes.filter((p) => !p.pass)) {
          lines.push(`  FAIL probe: ${p.name} — ${p.reason}`);
        }
        for (const s of r.scenarios.filter((s) => !s.passed)) {
          lines.push(`  FAIL scenario: ${s.name}`);
        }
        return lines.join("\n");
      }).join("\n\n");

      return { success: true, message: summary || "No endpoints to test.", data: { results, scope: { ...request, ...(modelId ? { modelId } : {}) } } };
    }

    case "list_patch_posture": {
      const { prisma } = await import("@dpf/db");
      const { getPatchPosture } = await import("@/lib/patch/patch-posture");
      const status = params["status"] === "all" ? "all" : "open";
      const posture = await getPatchPosture(
        prisma as unknown as Parameters<typeof getPatchPosture>[0],
        { status, limit: 200 },
      );
      const severity = typeof params["severity"] === "string" ? params["severity"] : undefined;
      const findings = severity
        ? posture.findings.filter((finding) => finding.policySeverity === severity)
        : posture.findings;
      const totals = posture.totals;
      return {
        success: true,
        message: `Estate patch posture: ${totals.findings} open finding(s) across ${totals.hosts} host(s) — ${totals.bySeverity.critical ?? 0} critical, ${totals.bySeverity.high ?? 0} high, ${totals.kev} actively exploited (KEV).`,
        data: {
          totals,
          capped: posture.capped,
          findings: findings.slice(0, 50),
        },
      };
    }

    case "get_finance_period_summary": {
      const { formatFinancePeriodSummary, getFinancePeriodSummary } = await import("@/lib/finance/period-summary");
      const periodInput: Parameters<typeof getFinancePeriodSummary>[0] = {};
      const period = typeof params["period"] === "string" ? params["period"] : undefined;
      if (period === "month-to-date" || period === "last-month" || period === "quarter-to-date" || period === "year-to-date") {
        periodInput.period = period;
      }
      if (typeof params["startDate"] === "string" && params["startDate"].trim()) {
        periodInput.startDate = params["startDate"];
      }
      if (typeof params["endDate"] === "string" && params["endDate"].trim()) {
        periodInput.endDate = params["endDate"];
      }

      try {
        const summary = await getFinancePeriodSummary(periodInput);
        return {
          success: true,
          message: formatFinancePeriodSummary(summary),
          data: summary as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const msg = getErrorMessage(err);
        return { success: false, error: msg, message: `get_finance_period_summary failed: ${msg}` };
      }
    }

    // ─── Email setup (PBI-INV-04 Phase 2) ───────────────────────────────
    case "setup_email": {
      const { runEmailSetupTool } = await import("./shared/email-setup-tool");
      const result = await runEmailSetupTool({
        action: String(params.action ?? "") as "detect" | "save" | "test",
        host: typeof params.host === "string" ? params.host : undefined,
        port: typeof params.port === "number" ? params.port : undefined,
        secure: typeof params.secure === "boolean" ? params.secure : undefined,
        user: typeof params.user === "string" ? params.user : undefined,
        from: typeof params.from === "string" ? params.from : undefined,
        pass: typeof params.pass === "string" ? params.pass : undefined,
        to: typeof params.to === "string" ? params.to : undefined,
      });
      return {
        success: result.ok,
        message: result.message,
        ...(result.error ? { error: result.error } : {}),
        data: result.data,
      };
    }

    // ─── Admin Coworker Tools (TAK-ADMIN-001) ────────────────────────────
    // All admin tools audit-log every call to AdminActivity.

    case "admin_view_logs": {
      const service = String(params.service ?? "");
      const lines = Math.min(Number(params.lines) || 100, 500);
      const ALLOWED_SERVICES = ["portal", "sandbox", "postgres", "neo4j", "qdrant", "portal-init", "browser-use"];
      if (!ALLOWED_SERVICES.includes(service)) {
        return { success: false, error: `Invalid service. Allowed: ${ALLOWED_SERVICES.join(", ")}`, message: `Unknown service "${service}".` };
      }
      try {
        const { exec: execCb } = lazyChildProcess();
        const { promisify } = lazyUtil();
        const execAsync = promisify(execCb);
        const { stdout } = await execAsync(`docker compose logs ${service} --tail ${lines} --no-color 2>&1`, {
          cwd: process.env.PROJECT_ROOT || "/app",
          timeout: 15_000,
        });
        await logAdminActivity(userId, "admin_view_logs", { service, lines }, "success", 1, stdout.slice(0, 500));
        return { success: true, message: `Last ${lines} lines from ${service}:`, data: { service, output: stdout.slice(0, 30000) } };
      } catch (err) {
        const msg = (err as Error).message?.slice(0, 500) ?? "Failed";
        await logAdminActivity(userId, "admin_view_logs", { service, lines }, "error", 1, msg);
        return { success: true, message: `Logs from ${service}:`, data: { service, output: msg } };
      }
    }

    case "admin_query_db": {
      const sql = String(params.sql ?? "").trim();
      if (!sql) return { success: false, error: "sql is required.", message: "Provide a SQL query." };
      // Only allow SELECT (and WITH ... SELECT)
      // CodeQL #23 (js/polynomial-redos): bound the unbounded `.*` and
      // `[\s\S]*?` runs so adversarial SQL with thousands of `-` or
      // `/*` chars can't trigger polynomial backtracking. SQL queries
      // in this tool are bounded by the admin tool surface; 100k chars
      // is well above any legitimate query.
      const normalized = sql
        .slice(0, 100_000)
        .replace(/--[^\n]{0,10000}/gm, "")
        .replace(/\/\*[\s\S]{0,10000}?\*\//g, "")
        .trim();
      if (!/^(SELECT|WITH)\b/i.test(normalized)) {
        await logAdminActivity(userId, "admin_query_db", { sql }, "blocked", 1, "Only SELECT queries permitted");
        return { success: false, error: "Only SELECT queries are permitted.", message: "This tool is read-only. Use SELECT statements only." };
      }
      if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i.test(normalized)) {
        await logAdminActivity(userId, "admin_query_db", { sql }, "blocked", 1, "DML/DDL detected in query");
        return { success: false, error: "Query contains forbidden keywords (INSERT, UPDATE, DELETE, DROP, etc).", message: "This tool is read-only." };
      }
      try {
        const result = await prisma.$queryRawUnsafe(sql + " LIMIT 1000") as unknown[];
        const preview = JSON.stringify(result).slice(0, 500);
        await logAdminActivity(userId, "admin_query_db", { sql }, "success", 1, `${result.length} rows. ${preview}`);
        return { success: true, message: `Query returned ${result.length} row(s).`, data: { sql, rows: result, rowCount: result.length } };
      } catch (err) {
        const msg = (err as Error).message?.slice(0, 500) ?? "Query failed";
        await logAdminActivity(userId, "admin_query_db", { sql }, "error", 1, msg);
        return { success: false, error: msg, message: `Query failed: ${msg}` };
      }
    }

    case "admin_read_file": {
      const filePath = String(params.path ?? "");
      if (!filePath) return { success: false, error: "path is required.", message: "Provide a file path." };
      const { resolve, join } = lazyPath();
      const { readFile } = lazyFsPromises();
      const root = process.env.PROJECT_ROOT ? resolve(process.env.PROJECT_ROOT) : resolve(getCwd(), "..", "..");
      const resolved = resolve(join(root, filePath));
      if (!resolved.startsWith(root)) {
        await logAdminActivity(userId, "admin_read_file", { path: filePath }, "blocked", 1, "Path traversal");
        return { success: false, error: "Path traversal blocked.", message: "File path must be within the project directory." };
      }
      // Block sensitive files
      const lower = filePath.toLowerCase();
      if (/\.(env|key|pem)$/.test(lower) || /secret/i.test(lower) || lower.includes(".env")) {
        await logAdminActivity(userId, "admin_read_file", { path: filePath }, "blocked", 1, "Sensitive file");
        return { success: false, error: "Sensitive file blocked.", message: "Cannot read .env, .key, .pem, or *secret* files through this tool." };
      }
      try {
        const raw = await readFile(resolved, "utf-8");
        const allLines = raw.split("\n");
        const offset = params.offset ? Number(params.offset) : 1;
        const limit = params.limit ? Number(params.limit) : allLines.length;
        const startLine = offset - 1;
        const slice = allLines.slice(startLine, startLine + limit);
        const numbered = slice.map((line: string, i: number) => `${String(startLine + i + 1).padStart(6)}\t${line}`).join("\n");
        await logAdminActivity(userId, "admin_read_file", { path: filePath, offset, limit }, "success", 1, `${slice.length} lines`);
        return { success: true, message: `File: ${filePath} (${slice.length} lines)`, data: { path: filePath, content: numbered } };
      } catch {
        return { success: false, error: `File not found: ${filePath}`, message: `Could not read ${filePath}` };
      }
    }

    case "admin_restart_service": {
      const service = String(params.service ?? "");
      // Label-resolved `docker restart` — the runtime image ships no compose
      // file, so `docker compose restart` always failed here (BI-01EA3EBE).
      const { restartPlatformService } = await import("@/lib/operate/service-restart");
      try {
        const { exec: execCb } = lazyChildProcess();
        const { promisify } = lazyUtil();
        const execAsync = promisify(execCb);
        await logAdminActivity(userId, "admin_restart_service", { service }, "success", 2, `Restarting ${service}`);
        const result = await restartPlatformService(service, execAsync);
        if (!result.success) {
          return { success: false, error: result.error ?? result.message, message: result.message };
        }
        return { success: true, message: result.message, data: { service, container: result.container } };
      } catch (err) {
        const msg = (err as Error).message?.slice(0, 500) ?? "Restart failed";
        return { success: false, error: msg, message: `Failed to restart ${service}: ${msg}` };
      }
    }

    case "admin_run_migration": {
      try {
        const { exec: execCb } = lazyChildProcess();
        const { promisify } = lazyUtil();
        const execAsync = promisify(execCb);
        await logAdminActivity(userId, "admin_run_migration", {}, "success", 2, "Running prisma migrate deploy");
        const { stdout, stderr } = await execAsync(
          `docker compose exec -T portal pnpm --filter @dpf/db exec prisma migrate deploy 2>&1`,
          { cwd: process.env.PROJECT_ROOT || "/app", timeout: 120_000 },
        );
        const output = (stdout + "\n" + stderr).trim();
        return { success: true, message: "Migration deploy complete.", data: { output: output.slice(0, 5000) } };
      } catch (err) {
        const msg = (err as Error).message?.slice(0, 1000) ?? "Migration failed";
        return { success: false, error: msg, message: `Migration failed: ${msg}` };
      }
    }

    case "admin_run_seed": {
      try {
        const { exec: execCb } = lazyChildProcess();
        const { promisify } = lazyUtil();
        const execAsync = promisify(execCb);
        await logAdminActivity(userId, "admin_run_seed", {}, "success", 2, "Running seed");
        const { stdout, stderr } = await execAsync(
          `docker compose exec -T portal pnpm --filter @dpf/db run seed 2>&1`,
          { cwd: process.env.PROJECT_ROOT || "/app", timeout: 300_000 },
        );
        const output = (stdout + "\n" + stderr).trim();
        return { success: true, message: "Seed complete.", data: { output: output.slice(0, 5000) } };
      } catch (err) {
        const msg = (err as Error).message?.slice(0, 1000) ?? "Seed failed";
        return { success: false, error: msg, message: `Seed failed: ${msg}` };
      }
    }

    case "admin_run_command": {
      const command = String(params.command ?? "").trim();
      if (!command) return { success: false, error: "command is required.", message: "Provide a command." };

      // Allowlist: only docker compose, git, and pnpm commands
      if (!/^(docker compose|git|pnpm)\b/.test(command)) {
        await logAdminActivity(userId, "admin_run_command", { command }, "blocked", 3, "Command not in allowlist");
        return {
          success: false,
          error: "Only docker compose, git, and pnpm commands are permitted.",
          message: `Command blocked: "${command.slice(0, 80)}". Only docker compose, git, and pnpm commands are allowed.`,
        };
      }

      // Block destructive patterns
      const ADMIN_BLOCKED = [
        /rm\s+-rf/i,
        /docker compose\s+down/i,
        /git\s+push/i,
        /git\s+reset\s+--hard/i,
        /prisma\s+migrate\s+reset/i,
        /curl\s+.*\|\s*(ba)?sh/i,
        /wget\s+.*\|\s*(ba)?sh/i,
        /--privileged/i,
        /--force/i,
      ];
      const blocked = ADMIN_BLOCKED.find(p => p.test(command));
      if (blocked) {
        await logAdminActivity(userId, "admin_run_command", { command }, "blocked", 3, "Destructive command blocked");
        return {
          success: false,
          error: "Destructive command blocked by safety policy.",
          message: `This command is blocked: "${command.slice(0, 80)}". Destructive operations (rm -rf, docker compose down, git push, --force) require manual execution in the terminal.`,
        };
      }

      try {
        const { exec: execCb } = lazyChildProcess();
        const { promisify } = lazyUtil();
        const execAsync = promisify(execCb);
        await logAdminActivity(userId, "admin_run_command", { command }, "success", 2, `Running: ${command.slice(0, 200)}`);
        const { stdout, stderr } = await execAsync(command + " 2>&1", {
          cwd: process.env.PROJECT_ROOT || "/app",
          timeout: 60_000,
        });
        const output = (stdout + "\n" + stderr).trim();
        return { success: true, message: `Command completed.`, data: { command, output: output.slice(0, 15000) } };
      } catch (err) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        const output = ((execErr.stdout ?? "") + "\n" + (execErr.stderr ?? "")).trim();
        if (output) return { success: true, message: "Command exited with error.", data: { command, output: output.slice(0, 15000) } };
        return { success: false, error: (execErr.message ?? "Command failed").slice(0, 1000), message: `Failed: ${command.slice(0, 80)}` };
      }
    }

    case "trigger_contributor_inventory_sync": {
      // BI-063BDF1B Phase 5 — admin-scope handle for agents to dispatch the
      // on-demand Inngest event. The runner is contributorInventorySyncOnDemand
      // in apps/web/lib/queue/functions/contributor-inventory-sync.ts.
      const reason = typeof params["reason"] === "string" ? params["reason"] : null;
      try {
        const { inngest } = await import("@/lib/queue/inngest-client");
        const result = await inngest.send({
          name: "ops/contributor-inventory-sync.run",
          data: { triggeredBy: reason ? `mcp:${reason}` : "mcp" },
        });
        return {
          success: true,
          message: "Queued an on-demand contributor inventory sync.",
          data: { eventIds: result.ids, status: "queued" },
        };
      } catch (err) {
        const msg = getErrorMessage(err);
        return {
          success: false,
          error: msg,
          message: `trigger_contributor_inventory_sync failed: ${msg}`,
        };
      }
    }

    default: {
      const { parseNamespacedTool, executeMcpServerTool } = await import("./mcp-server-tools");
      const parsed = parseNamespacedTool(toolName);
      if (parsed) {
        return executeMcpServerTool(parsed.serverSlug, parsed.toolName, params);
      }
      // CodeQL #52 (js/tainted-format-string): toolName is user-influenced.
      // Use a constant message and put the raw value in error for diagnostics.
      return { success: false, error: "Unknown tool", message: "Tool not found" };
    }
  }
  } catch (err) {
    const msg = getErrorMessage(err);
    // CodeQL #52 (js/tainted-format-string) + js/log-injection: keep the
    // format string constant so a `%s` inside an attacker-controlled
    // toolName cannot consume the next argument, AND JSON.stringify each
    // tainted positional arg so CR/LF can't forge log lines.
    console.error("[executeTool] Uncaught exception in tool %s: %s",
      JSON.stringify(toolName), JSON.stringify(msg));
    return { success: false, error: msg, message: `Tool ${toolName} failed: ${msg}` };
  }
}

// ─── Convert to provider format ──────────────────────────────────────────────

export function toolsToOpenAIFormat(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      annotations: resolveAnnotations(t),
    },
  }));
}
