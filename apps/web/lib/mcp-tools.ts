import { can, type CapabilityKey, type UserContext } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { ENTERPRISE_ARCHITECT_DISPLAY_NAME } from "@dpf/db/agent-identity";
// Static import: executeTool is a hot path; dynamic import per call would hurt throughput.
import { evaluateExecution } from "@/lib/kernel/runtime-gate";
import { loadEnforceablePrinciples } from "@/lib/kernel/load-enforceable-principles";
import { detectSessionClass } from "@/lib/kernel/session-class";
import { kernelGateDecisionsTotal } from "@/lib/operate/metrics";
import * as crypto from "crypto";
import { lazyFs, lazyFsPromises, lazyPath, lazyChildProcess, lazyUtil, getCwd } from "@/lib/shared/lazy-node";
import { slugify } from "@/lib/shared/slugify";
import {
  logBuildActivity, recordAutoIntakeFailure,
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
import type { AuthorizedSurfaceToolExecutionContext } from "@/lib/coworker/authorized-surface-execution-types";
// ─── Types ───────────────────────────────────────────────────────────────────
export type BuildPhaseTag = "ideate" | "plan" | "build" | "review" | "ship";
export type ToolExecutionContext = AuthorizedSurfaceToolExecutionContext & {
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
  tokenScope?: string; authorityDecisionId?: string; suppressDesignReviewAutoRepair?: boolean; suppressPlanReviewAutoRepair?: boolean;
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

/**
 * Declared reach of a tool's effect. See `ToolDefinition.consequence`.
 * Closed set: a new axis is a deliberate widening of what the gate governs,
 * not a string literal someone invents at a call site.
 */
export type ToolConsequence = "outward" | "irreversible";

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** MCP 2025-11-25 optional metadata. `title` is a human-facing label (falls
   *  back to a de-underscored name); `icons` are display hints; `outputSchema`
   *  declares the structured-result shape as JSON Schema (2020-12 dialect). */
  title?: string;
  icons?: Array<{ src: string; mimeType?: string; sizes?: string }>;
  outputSchema?: Record<string, unknown>;
  requiredCapability: CapabilityKey | null;
  requiresExternalAccess?: boolean;
  executionMode?: "proposal" | "immediate";
  sideEffect?: boolean;
  /**
   * How far this tool's effect reaches. DECLARED, not inferred: "can this be
   * undone" is not recoverable from the name, the schema, or `sideEffect`
   * (true for `update_backlog_item` and `place_linkedin_ad` alike).
   * `outward` = leaves the platform (third party, publish, spend) → the
   * business stance governs it, so it is alignment-gated. `irreversible` =
   * stays inside but no inverse call restores prior state → receipted, not
   * alignment-gated. Absent = ordinary, which is a claim the coverage test
   * pins rather than a default. Rationale: consequential-tool-policy.ts.
   */
  consequence?: ToolConsequence;
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
  // BI-297863B2: flips a FeatureBuild to abandoned — can't quietly take back.
  "abandon_stalled_build",
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
    // build tool moved to a ToolPack
    // build tool moved to a ToolPack
    // build tool moved to a ToolPack
    // build tool moved to a ToolPack
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
  // reconcile_build_engines moved to a build ToolPack
  // provision_build_engine moved to a build ToolPack
  // get_build_engine_readiness moved to a build ToolPack
    // build tool moved to a ToolPack
  // run_tool_script moved to a build ToolPack
    // build tool moved to a ToolPack
    // build tool moved to a ToolPack
    // build tool moved to a ToolPack
    // build tool moved to a ToolPack
  // ─── Email setup (PBI-INV-04 Phase 2) ──────────────────────────────────
  // Lets the onboarding/COO coworker walk a non-technical operator through
  // configuring their OWN outbound email (SMTP). Operator-only
  // (manage_provider_connections) + the `email_config` agent grant.
  // ─── Hive Mind Contribution Tools (IT4IT §5.5 Release) ───────────────────
  // assess_contribution def moved to mcp/packs/contribution-hive-pack.ts
  // contribute_to_hive def moved to mcp/packs/contribution-hive-pack.ts
    // build tool moved to a ToolPack
  // ─── Codebase Access Tools ──────────────────────────────────────────────────
    // build tool moved to a ToolPack
    // build tool moved to a ToolPack
  // ─── Manifest Tools ────────────────────────────────────────────────────────
  // propose_file_change moved to a build ToolPack
  // ─── Feedback Loop ──────────────────────────────────────────────────────────
  // propose_improvement def moved to mcp/packs/contribution-hive-pack.ts
  // propose_skill_improvement def moved to mcp/packs/contribution-hive-pack.ts
  // ─── Provider Management ────────────────────────────────────────────────────
  // submit_feedback def moved to mcp/packs/contribution-hive-pack.ts
  // principle_decide def moved to mcp/packs/principle-decide-pack.ts
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
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/g, "[redacted-token]")
    // BI-1291B677: Anthropic OAuth tokens (sk-ant-oat01-*) and API keys
    // (sk-ant-api03-*) in raw form.
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "[redacted-token]")
    // BI-1291B677: a secret staged into the sandbox as `echo '<base64>' | base64 -d`
    // (the CLI dispatch token / mcp-config write). Redact the base64 payload so a
    // surfaced docker command can't be reversed back to the secret.
    .replace(/echo '[A-Za-z0-9+\/=]{20,}'(\s*\|\s*base64\s+-d)/g, "echo '[redacted-token]'$1");
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

    // build tool moved to a ToolPack

    // build tool moved to a ToolPack

    // build tool moved to a ToolPack

    // build tool moved to a ToolPack


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
          const fixPlan = (build.plan as Record<string, unknown> | null);
          const gate = checkPhaseGate("ideate", "plan", { kind: "fix", processSize: fixProcessSize, deliverableSensitivity: fixPlan?.deliverableSensitivity, qualityFirst: fixPlan?.qualityFirst === true, fixContext: fc, designReview: review });
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
          `You are the ${ENTERPRISE_ARCHITECT_DISPLAY_NAME} (DPF chief-architect lens) reviewing for architectural alignment. Advisory only — surface concerns and concrete spec edits, never block the gate.`,
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
      let review = architectureAdvisory ? { ...reviewWithIteration, architectureAdvisory } : reviewWithIteration;
      // A3 (BI-D506598C): governed Data Architect consultation, flag-gated
      // default-off. Unlike the anonymous `architect` routeAndCall above, this is
      // attributed to the real AGT-BUILD-DA Agent and informed by its profession
      // corpus (BI-B31072B8) — actor trail, not just artifact trail. Advisory
      // only; never gates. Strict no-op when the flag is off (skipped=true).
      try {
        const { runGovernedDaConsultationViaRouteAndCall } = await import(
          "@/lib/integrate/governed-data-architect-consultation"
        );
        const daAdvisory = await runGovernedDaConsultationViaRouteAndCall({
          doc: typeof build.designDoc === "string" ? build.designDoc : JSON.stringify(designDocTyped),
          db: prisma,
          transport: (messages, systemPrompt) =>
            routeAndCall(messages, systemPrompt, "internal", { budgetClass: "minimize_cost" }),
        });
        if (!daAdvisory.skipped && daAdvisory.findings.length > 0) {
          review = Object.assign({}, review, { dataArchitectureAdvisory: daAdvisory }) as typeof review;
          logBuildActivity(buildId, "reviewDesignDoc", `Data Architect consultation (advisory, ${daAdvisory.agentId}): ${daAdvisory.findings.length} finding(s).`);
        }
      } catch (e) {
        console.warn("[reviewDesignDoc] governed DA consultation failed (fail-open):", e);
      }
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
            parentEpicId: true,
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
            // Governed-backlog autopilot: rather than park a hands-off
            // auto-promoted build at the operator decomposition gate forever
            // (BI-C4F828B7 self-perpetuating loop), resolve it autonomously —
            // auto-approve the top decomposition candidate, or auto-override to
            // ship monolithically as a fallback. Operator-driven / non-governed
            // builds return "park" and keep the original wait-for-operator gate.
            const { autoResolveDecomposeRequiredGate } = await import(
              "@/lib/build/auto-resolve-decompose-gate"
            );
            const auto = await autoResolveDecomposeRequiredGate({
              build: {
                buildId,
                parentEpicId: updatedBuild.parentEpicId ?? null,
                originatingBacklogItemId: updatedBuild.originatingBacklogItemId ?? null,
                designReview: updatedBuild.designReview,
              },
              userId,
              governedBacklogEnabled: governedConfig?.governedBacklogEnabled === true,
            });

            if (auto.action === "decomposed") {
              logBuildActivity(
                buildId,
                "auto-decompose",
                `Governed autopilot auto-decomposed into ${auto.childBuildIds.length} child build(s) under Epic ${auto.epicId} (candidate ${auto.candidateId}).`,
              );
              return {
                success: true,
                message: `Design review: ${review.decision}. Size assessment was decompose-required; under governed autopilot this build was auto-decomposed into ${auto.childBuildIds.length} child build(s) under Epic ${auto.epicId}, which now proceed independently.`,
                data: {
                  review,
                  decomposed: true,
                  epicId: auto.epicId,
                  childBuildIds: auto.childBuildIds,
                },
              };
            }

            if (auto.action === "already-decomposed") {
              // Duplicate promotion: the BI already has a decomposition Epic
              // whose children carry this work (BI-1D0CA7A0). Block the advance —
              // never override to monolithic, which would ship it twice.
              const epic = auto.existingEpicId ?? "(unknown)";
              logBuildActivity(buildId, "phase:gate-blocked", `decompose-required gate fired, but the backlog item is already decomposed into Epic ${epic}; advance blocked as a duplicate promotion.`);
              return {
                success: true,
                message: `Design review: ${review.decision}, but this build's backlog item is already decomposed into Epic ${epic}, whose child builds already carry the work. This build is a duplicate promotion — retire it rather than decomposing or overriding it.`,
                data: { review, blocked: true, action: "duplicate_promotion", existingEpicId: auto.existingEpicId ?? null },
              };
            }

            if (auto.action === "park") {
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

            // auto.action === "overridden": the monolithic override is now
            // recorded in the DB, so the decompose gate no longer blocks. Fall
            // through to the phase-advance logic below.
            logBuildActivity(
              buildId,
              "auto-decompose-override",
              `Governed autopilot recorded a monolithic override (${auto.reason}); proceeding to Plan as a single build.`,
            );
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
              recordAutoIntakeFailure(buildId, "epic", err);
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
              recordAutoIntakeFailure(buildId, "backlog", err);
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
              recordAutoIntakeFailure(buildId, "constrained-goal", err);
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
              recordAutoIntakeFailure(buildId, "taxonomy-anchor", err);
            }
          }

          const idpPlan = (updatedBuild.plan as Record<string, unknown> | null);
          const gate = checkPhaseGate("ideate", "plan", {
            kind: updatedBuild.kind,
            processSize: (idpPlan?.processSize as string | undefined) ?? "medium",
            deliverableSensitivity: idpPlan?.deliverableSensitivity,
            qualityFirst: idpPlan?.qualityFirst === true,
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
        const { performPlanToBuildTransition } = await import("@/lib/integrate/plan-to-build-transition");
        const outcome = await performPlanToBuildTransition({ buildId, userId, context });
        if (outcome.kind === "escalated") {
          logBuildActivity(buildId, "reviewBuildPlan", `plan → build escalated to operator after ${outcome.failures} failed transition attempts (${outcome.reason}).`);
        }
      } catch (err) {
        console.error("[reviewBuildPlan] auto-advance failed:", err);
      }

      return { success: true, message: `Plan review: ${review.decision}. ${review.summary}${archAdvisoryNote}`, data: { review } };
    }

    // reconcile_build_engines moved to a build ToolPack

    // provision_build_engine moved to a build ToolPack

    // get_build_engine_readiness moved to a build ToolPack





    // build tool moved to a ToolPack




    // run_tool_script moved to a build ToolPack

    // ─── Sandbox File Tools ──────────────────────────────────────────────────
    // Shared auto-init: ensure sandbox is initialized before any file tool runs.
    // Falls through to the specific tool case after initialization.


    // build tool moved to a ToolPack

    // build tool moved to a ToolPack

    // ─── Portal PR Creation & Merge ────────────────────────────────────────

    // build tool moved to a ToolPack

    // ─── Hive Mind Contribution ──────────────────────────────────────────────

    // assess_contribution case moved to mcp/packs/contribution-hive-pack.ts

    // build tool moved to a ToolPack

    // contribute_to_hive case moved to mcp/packs/contribution-hive-pack.ts

    // build tool moved to a ToolPack

    // build tool moved to a ToolPack

    // build tool moved to a ToolPack

    // ─── Design Intelligence Tools (UI UX Pro Max) ──────────────────────────
    // propose_file_change moved to a build ToolPack

    // propose_improvement case moved to mcp/packs/contribution-hive-pack.ts

    // propose_skill_improvement case moved to mcp/packs/contribution-hive-pack.ts

    // submit_feedback case moved to mcp/packs/contribution-hive-pack.ts

    // principle_decide case moved to mcp/packs/principle-decide-pack.ts

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
