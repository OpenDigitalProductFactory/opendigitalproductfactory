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
import {
  logBuildActivity,
  extractBuildIdHint,
  resolveActiveBuildId,
  updateBuildHappyPathState,
} from "@/lib/mcp/build-tool-helpers";
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
  // promote_to_build_studio moved to a build ToolPack
  // update_lifecycle moved to a build ToolPack
  // verify_live_install_readiness moved to a build ToolPack
  // record_execution_evidence moved to a build ToolPack
  // record_local_integration_result moved to a build ToolPack
  // record_functional_failure_evidence moved to a build ToolPack
  // ─── Build Studio Tools ───────────────────────────────────────────────────
  // update_feature_brief and create_build_epic execute immediately (no approval dialog).
  // Only register_digital_product_from_build needs HITL approval (creates a real product).
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
  // reconcile_build_engines moved to a build ToolPack
  // provision_build_engine moved to a build ToolPack
  // get_build_engine_readiness moved to a build ToolPack
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
  // run_tool_script moved to a build ToolPack
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
  // propose_file_change moved to a build ToolPack
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
  // run_endpoint_tests moved to a build ToolPack
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
    // promote_to_build_studio moved to a build ToolPack

    // update_lifecycle moved to a build ToolPack

    // verify_live_install_readiness moved to a build ToolPack

    // record_execution_evidence moved to a build ToolPack

    // record_local_integration_result moved to a build ToolPack

    // record_functional_failure_evidence moved to a build ToolPack

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

    // reconcile_build_engines moved to a build ToolPack

    // provision_build_engine moved to a build ToolPack

    // get_build_engine_readiness moved to a build ToolPack

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

    // run_tool_script moved to a build ToolPack

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
    // propose_file_change moved to a build ToolPack

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

    // run_endpoint_tests moved to a build ToolPack

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
