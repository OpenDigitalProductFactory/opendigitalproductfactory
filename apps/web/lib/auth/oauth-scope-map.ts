// The public OAuth scope vocabulary for the MCP resource, and its total
// mapping onto the internal grant vocabulary.
//
// WHY A SEPARATE VOCABULARY. TOOL_TO_GRANTS carries 86 distinct grant
// categories. Publishing those as OAuth scopes would (1) make the consent
// screen unreadable — nobody meaningfully approves 86 checkboxes, and a
// consent screen nobody reads is worse than none; (2) produce maximal grants
// by default, because the MCP spec tells clients to request everything in
// `scopes_supported` when the 401 challenge carries no `scope`; and (3) freeze
// 86 internal names as a public API, the way tool names are already frozen.
//
// So the public contract is six strings. Internal grants stay refactorable —
// split, merge and rename them freely — as long as the map below stays TOTAL.
// `oauth-scope-map.test.ts` asserts totality and fails CI when a new grant
// arrives unmapped. That test is the whole reason this is safe; do not delete
// it to make a build pass.
//
// Design: docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §4.3.1

import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";
import type { McpTokenScope } from "@/lib/auth/mcp-api-token";

// The vocabulary itself lives in the pure module so client components can use
// it; re-exported here so every existing server import keeps working.
export { PUBLIC_SCOPES, PUBLIC_SCOPE_COPY, type PublicScope } from "@/lib/auth/oauth-public-scopes";
import { PUBLIC_SCOPES, type PublicScope } from "@/lib/auth/oauth-public-scopes";

/** The coarse tier each public scope implies. The tier is DERIVED from the
 *  granted scope set (see `coarseScopeForPublicScopes`) — a client never
 *  requests it separately, so it cannot be got wrong. */
const PUBLIC_SCOPE_TIER: Record<PublicScope, McpTokenScope> = {
  "dpf.read": "read",
  "dpf.work": "write",
  "dpf.build": "write",
  "dpf.business": "write",
  "dpf.operate": "write",
  "dpf.admin": "admin",
};

/**
 * The total map. Every grant in TOOL_TO_GRANTS appears in exactly one bucket.
 *
 * The partition axis is read-vs-write, with ONE deliberate exception:
 * `admin_read` sits in `dpf.admin` rather than `dpf.read`, because platform
 * administration is a distinct consent decision whether it is being read or
 * written. Every other `*_read` grant is in `dpf.read`.
 *
 * The cut lines are an operator decision (design §9.4); the SMALLNESS is not.
 * The likeliest line to move is the screen/browser driving trio in `dpf.work`
 * — those act on the operator's behalf through a UI rather than writing a
 * governed record, and an operator may reasonably want them named separately.
 */
export const PUBLIC_SCOPE_TO_GRANTS: Record<PublicScope, readonly string[]> = {
  "dpf.read": [
    "agent_control_read",
    "architecture_read",
    "backlog_read",
    "banking_read",
    "browser_read",
    "code_graph_read",
    "consumer_read",
    "coworker_catalog_read",
    "coworker_screen_read",
    "crm_read",
    "deliberation_read",
    "document_read",
    "ea_graph_read",
    "external_registry_search",
    "file_read",
    "marketing_read",
    "policy_read",
    "portfolio_read",
    "registry_read",
    "release_plan_read",
    "siem_read",
    "spec_plan_read",
    "stock_read",
    "storefront_read",
    "telemetry_read",
    "thread_read",
    "web_search",
    "work_capsule_read",
    "work_engagement_read",
    "work_room_read",
    "workbook_read",
  ],
  "dpf.work": [
    "backlog_triage",
    "backlog_write",
    "browser_drive",
    "coworker_engagement_write",
    "coworker_screen_drive",
    "coworker_screen_fill",
    "critique_capture",
    "data_governance_validate",
    "decision_record_create",
    "deliberation_create",
    "document_publish",
    "document_write",
    // BI-4C17BF51. Renders an EA view and stores it as a document, so it is a write.
    "ea_drawing_export",
    "ea_graph_write",
    "initiative_archetype_review",
    "initiative_architecture_review",
    "initiative_compliance_review",
    "initiative_data_review",
    "initiative_design_review",
    "initiative_domain_review",
    "initiative_evidence_write",
    "initiative_security_review",
    "initiative_ux_review",
    "registry_write",
    // BI-8E1FD1BD. Propose-only: it records a statutory figure as `proposed` with
    // its citation. It cannot ratify — checkStatutoryRatification refuses every
    // agent unconditionally and no ratify tool exists — so it belongs with the
    // other propose/review writes here rather than in an admin scope.
    "statutory_reference_propose",
    "thread_write",
    "tool_evaluation_create",
    "work_capsule_adopt",
    "work_capsule_write",
    "work_engagement_transition",
    "work_engagement_write",
    "work_room_write",
    "workbook_write",
    "workroom_evidence_write",
  ],
  "dpf.build": [
    "build_evidence",
    "build_lifecycle",
    "build_phase_advance",
    "build_plan_write",
    "build_promote",
    "sandbox_execute",
    "tool_script_exec",
  ],
  "dpf.business": [
    "banking_write",
    "consumer_write",
    "crm_write",
    "enrichment_write",
    "financial_report_create",
    "marketing_write",
  ],
  "dpf.operate": [
    "deployment_plan_create",
    "iac_execute",
    "incident_respond",
    "release_gate_create",
    "release_plan_create",
    "siem_investigate",
    "siem_tune",
  ],
  "dpf.admin": ["admin_read", "admin_write", "email_config", "policy_write"],
};

/** Every grant name referenced by TOOL_TO_GRANTS. The `[]` entries mean
 *  identity-scoped universal access and contribute no grant names. This is the
 *  set the map must cover exactly — computed, never hand-maintained. */
export function allKnownGrants(): string[] {
  const set = new Set<string>();
  for (const grants of Object.values(TOOL_TO_GRANTS)) {
    for (const g of grants) set.add(g);
  }
  return Array.from(set).sort();
}

export function isPublicScope(value: string): value is PublicScope {
  return (PUBLIC_SCOPES as readonly string[]).includes(value);
}

/** Parse an OAuth `scope` parameter (space-delimited per RFC 6749 §3.3).
 *  Unknown entries are returned separately rather than silently dropped, so
 *  the caller can decide between `invalid_scope` and ignoring them. */
export function parseScopeParam(raw: string | null | undefined): {
  granted: PublicScope[];
  unknown: string[];
} {
  const parts = (raw ?? "").split(/\s+/).filter(Boolean);
  const granted: PublicScope[] = [];
  const unknown: string[] = [];
  for (const p of parts) {
    if (isPublicScope(p)) {
      if (!granted.includes(p)) granted.push(p);
    } else {
      unknown.push(p);
    }
  }
  return { granted, unknown };
}

/** Serialize back to an OAuth `scope` parameter, in vocabulary order so the
 *  value is stable for tests and for the consent screen. */
export function formatScopeParam(scopes: readonly PublicScope[]): string {
  return PUBLIC_SCOPES.filter((s) => scopes.includes(s)).join(" ");
}

/** Expand a granted public scope set into the internal grant list an
 *  MCP token carries. Deduplicated and sorted for a stable token payload. */
export function grantsForPublicScopes(scopes: readonly PublicScope[]): string[] {
  const set = new Set<string>();
  for (const s of scopes) {
    for (const g of PUBLIC_SCOPE_TO_GRANTS[s]) set.add(g);
  }
  return Array.from(set).sort();
}

/** Derive the coarse tier from the granted scope set: the highest tier any
 *  granted scope implies. An empty set is `read` — the floor, never a
 *  privilege. */
export function coarseScopeForPublicScopes(scopes: readonly PublicScope[]): McpTokenScope {
  let tier: McpTokenScope = "read";
  for (const s of scopes) {
    const t = PUBLIC_SCOPE_TIER[s];
    if (t === "admin") return "admin";
    if (t === "write") tier = "write";
  }
  return tier;
}

/** The reverse direction, used to build a step-up `scope` challenge: which
 *  public scopes would a caller need in order to hold this grant? Normally
 *  exactly one (the map is a partition), but the signature returns a list so a
 *  future non-partition map does not silently pick a winner. */
export function publicScopesGrantingGrant(grant: string): PublicScope[] {
  return PUBLIC_SCOPES.filter((s) => PUBLIC_SCOPE_TO_GRANTS[s].includes(grant));
}

/**
 * The scopes advertised in `scopes_supported` on the Protected Resource
 * Metadata document — and, through `oauth-metadata.ts`, the `scope=` on the
 * 401 challenge and the default for an authorize request that names none.
 *
 * MCP `2025-11-25` (`authorization.mdx:344-347`) defines this field as "the
 * minimal set of scopes necessary for BASIC FUNCTIONALITY", and tells clients
 * to request all of it when the challenge carries no `scope`. The question is
 * therefore what basic functionality means for THIS resource, and the answer
 * is not read.
 *
 * This MCP server exists to do development work: claim a workroom, record
 * evidence, move a backlog item, adopt a worktree. A grant that can do none
 * of those is not a reduced version of the product, it is a client that
 * cannot perform the task it connected to perform. Advertising read alone
 * was not a smaller promise, it was a broken one.
 *
 * WHY THE PREVIOUS READ-ONLY FLOOR COULD NOT STAND (BI-CE5F8C0A):
 * The floor was safe only because escalation was assumed reachable. It is
 * not. The 403 `insufficient_scope` step-up fires solely on `tools/call` of
 * a tool the grant does not cover, and `load_tools` filters by grant first,
 * answering "not-granted" as a plain HTTP 200 — so a read-only client never
 * sees the write tool, never calls it, and is never told a scope is missing.
 * Measured on a production install: every OAuth client landed read-only and no
 * step-up ever fired.
 *
 * Nor could a client work around it. Claude Code can pin `oauth.scopes` in
 * `.mcp.json`; Grok cannot — it derives its request from this very challenge
 * ("WWW-Authenticate challenge contains scope:") and has no scope setting at
 * all. A per-client pin fixes one of four peer delivery surfaces (AGENTS.md
 * §12) and strands the rest.
 *
 * WHAT IS DELIBERATELY NOT HERE: `dpf.business`, `dpf.operate` and
 * `dpf.admin`. Development is the basic functionality of this resource;
 * running the organization and administering the platform are not. Those
 * stay behind an explicit request, which a client may still make — widening
 * the floor does not cap the ceiling. The consent screen continues to list
 * every requested scope as its own checkbox, so the human still approves
 * each one.
 */
export const ADVERTISED_SCOPES: readonly PublicScope[] = [
  "dpf.read",
  "dpf.work",
  "dpf.build",
];
