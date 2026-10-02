// MCP tool contract types: the shapes every tool pack, dispatcher and
// coworker surface shares (ToolDefinition, ToolResult, ToolExecutionContext).
//
// Types only, and a leaf: this module may import types from modules that do
// not import back into the tool runtime, never from lib/mcp-tools.ts or a pack.
// It used to live inside lib/mcp-tools.ts, which made every pack's
// `import type` an edge into an import cycle of over 500 files; TypeScript
// project references need that graph acyclic (dependency-diet plan, M11
// step 2). The guard
// scripts/check-no-web-import-cycle-growth.mjs ratchets that cycle.

import type { CapabilityKey } from "@/lib/permissions";
import type { AuthorizedSurfaceToolExecutionContext } from "@/lib/coworker/authorized-surface-execution-types";
import type { OutcomeDisposition } from "@/lib/shared/outcome-disposition";
import type { ToolCallConsequenceRefiner, ToolConsequence, ToolConsequenceScope } from "@/lib/tool-consequence";

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
  /**
   * GPP Phase 2 PR-C (BI-69415B68): the permit the reference monitor verified
   * for this outward/authority/irreversible call ("GPM-..."), so a handler can
   * cite it downstream. Set only by the monitor; absent when no permit applies.
   */
  gppPermitId?: string;
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
   * WHOSE stance governs an `outward` effect (BI-63B14D4B). DECLARED with the
   * consequence, never inferred from the pack or the name.
   *
   * `business` (default) = the effect leaves the organization's business —
   * a campaign, an ad, a customer email — so the org's WWWD stance is the
   * authority and the call is alignment-gated against it.
   * `platform` = the effect leaves the INSTALL but is platform development or
   * operations — a pull request, a hive contribution, a discovery sweep, a
   * sign-in handshake. The founder kernel (WWMD) owns that judgement; asking
   * the customer's business stance "what should the business do?" about a
   * pull request routes a decision to a scope that has no authority over it
   * (decisions-belong-to-their-scope). Still consequential: receipted and
   * outward-reviewed, just not WWWD-alignment-gated.
   */
  consequenceScope?: ToolConsequenceScope;
  /** Narrows `consequence` for one call; may only narrow (tool-consequence.ts). */
  consequenceForCall?: ToolCallConsequenceRefiner;
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

export type ToolResult = {
  success: boolean;
  entityId?: string;
  message: string;
  error?: string;
  data?: Record<string, unknown>;
  /** `success` cannot say "awaiting a person"; this can. */
  disposition?: OutcomeDisposition;
};
