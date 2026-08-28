import { can, type CapabilityKey, type UserContext } from "@/lib/permissions";
import { prisma } from "@dpf/db";
// Static import: executeTool is a hot path; dynamic import per call would hurt throughput.
import { evaluateExecution } from "@/lib/kernel/runtime-gate";
import { loadEnforceablePrinciples } from "@/lib/kernel/load-enforceable-principles";
import { detectSessionClass } from "@/lib/kernel/session-class";
import { kernelGateDecisionsTotal } from "@/lib/operate/metrics";
// BI-ARCH-TOOLPACKS / W9 (BI-0E7B0953): every tool is owned by a scoped pack —
// definitions compose into PLATFORM_TOOLS and handlers dispatch through the
// registry (no per-tool handler imports or switch cases here anymore).
import { TOOL_PACK_REGISTRY } from "@/lib/mcp/pack-registry";
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
export type ToolConsequence = "outward" | "irreversible" | "authority";

/**
 * The closed set, as a runtime value. `deriveConsequentialToolNames`
 * (apps/web/lib/tak/consequential-tool-coverage.ts) derives the consult-gated
 * set from `sideEffect && consequence != null` — TAK §8.4.1, classification is
 * derived from a declared property, never re-enumerated in a second allowlist.
 */
export const TOOL_CONSEQUENCES: readonly ToolConsequence[] = [
  "outward",
  "irreversible",
  "authority",
] as const;

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
   * Keep schema-redacted input parameters in ToolExecution even when the tool
   * is metrics-only. Results remain suppressed. Use this for compact identity
   * evidence needed to prove an immutable or otherwise bound read.
   */
  retainAuditParameters?: boolean;
  /**
   * How far this tool's effect reaches. DECLARED, not inferred: "can this be
   * undone" is not recoverable from the name, the schema, or `sideEffect`
   * (true for `update_backlog_item` and `place_linkedin_ad` alike).
   * `outward` = leaves the platform (third party, publish, spend) → the
   * business stance governs it, so it is alignment-gated. `irreversible` =
   * stays inside but no inverse call restores prior state → receipted, not
   * alignment-gated. `authority` = changes who may act, on whose behalf, or
   * under what policy (identity, grants, leases, autonomy policy) — reversible
   * as a row, but every act taken under the changed authority in the meantime
   * is not. Absent = ordinary, which is a claim the coverage test pins rather
   * than a default. Rationale: consequential-tool-policy.ts.
   *
   * A declared consequence is ALSO what puts the tool behind the
   * consult-before-consequential-act gate (TAK §8.4.1: derived, not
   * enumerated). See apps/web/lib/tak/consequential-tool-coverage.ts.
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
  // saveBuildEvidence / reviewDesignDoc / reviewBuildPlan defs moved to mcp/packs/build-review-pack.ts
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

    // saveBuildEvidence moved to mcp/packs/build-review-pack.ts (build-review-handlers.ts)

    // reviewDesignDoc moved to mcp/packs/build-review-pack.ts (build-design-review-handler.ts)

    // reviewBuildPlan moved to mcp/packs/build-review-pack.ts (build-review-handlers.ts)

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
