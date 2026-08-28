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

/** The public scope vocabulary. This is an external API contract: adding a
 *  value is a compatible change, renaming or removing one is not. */
export const PUBLIC_SCOPES = [
  "dpf.read",
  "dpf.work",
  "dpf.build",
  "dpf.business",
  "dpf.operate",
  "dpf.admin",
] as const;

export type PublicScope = (typeof PUBLIC_SCOPES)[number];

/** Human-facing text for the consent screen. Deliberately describes what the
 *  holder can DO to the operator's business, not which internal grants are
 *  involved — the operator is approving an outcome, not a data structure. */
export const PUBLIC_SCOPE_COPY: Record<PublicScope, { title: string; detail: string }> = {
  "dpf.read": {
    title: "Read your platform",
    detail:
      "See backlog, work, documents, code, architecture, customers and operational data — everything you can see. Cannot change anything.",
  },
  "dpf.work": {
    title: "Do governed work",
    detail:
      "Create and update backlog items, workrooms, threads, documents, decisions and evidence, and drive portal screens on your behalf.",
  },
  "dpf.build": {
    title: "Run Build Studio",
    detail:
      "Write build plans, advance phases, record evidence, promote builds, and execute code in the sandbox.",
  },
  "dpf.business": {
    title: "Act on business records",
    detail: "Update customers, CRM, marketing and stock, and produce financial reports.",
  },
  "dpf.operate": {
    title: "Operate the platform",
    detail:
      "Create release and deployment plans, tune and investigate security monitoring, respond to incidents, and execute infrastructure changes.",
  },
  "dpf.admin": {
    title: "Administer the platform",
    detail: "Read and change platform administration, policy and integration configuration.",
  },
};

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
    "thread_write",
    "tool_evaluation_create",
    "work_capsule_adopt",
    "work_capsule_write",
    "work_engagement_transition",
    "work_engagement_write",
    "work_room_write",
    "workbook_write",
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
 * Metadata document.
 *
 * READ ONLY, deliberately. MCP `2025-11-25` (`authorization.mdx:344-347`)
 * defines this field as "the minimal set of scopes necessary for basic
 * functionality", and tells clients to request all of it when the challenge
 * carries no `scope`. Advertising only `dpf.read` is what makes that default
 * behaviour SAFE: a client that asks for everything advertised gets read
 * access, and every escalation above it is a separate, named, human-approved
 * step-up decision.
 */
export const ADVERTISED_SCOPES: readonly PublicScope[] = ["dpf.read"];
