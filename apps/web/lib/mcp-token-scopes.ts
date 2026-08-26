export const MCP_TOKEN_SCOPE_TIERS = ["read", "write", "admin"] as const;

export type McpTokenScopeTier = (typeof MCP_TOKEN_SCOPE_TIERS)[number];

export const READ_MCP_TOKEN_SCOPES = [
  "architecture_read",
  "backlog_read",
  "code_graph_read",
  "file_read",
  "spec_plan_read",
  "work_capsule_read",
] as const;

export const WRITE_MCP_TOKEN_SCOPES = [
  ...READ_MCP_TOKEN_SCOPES,
  "backlog_write",
  "work_capsule_write",
  "work_capsule_adopt",
] as const;

export const ADMIN_MCP_TOKEN_SCOPES = [
  ...WRITE_MCP_TOKEN_SCOPES,
  "admin_read",
  "admin_write",
] as const;

// Backward-compatible name for the standard read-scoped coding-agent grant set.
export const CODING_AGENT_MCP_TOKEN_SCOPES = READ_MCP_TOKEN_SCOPES;

function requestedScopesForTier(tier: McpTokenScopeTier): readonly string[] {
  if (tier === "admin") return ADMIN_MCP_TOKEN_SCOPES;
  if (tier === "write") return WRITE_MCP_TOKEN_SCOPES;
  return READ_MCP_TOKEN_SCOPES;
}

export function defaultMcpTokenScopes(
  availableScopes: readonly string[],
  tier: McpTokenScopeTier = "read",
): string[] {
  const available = new Set(availableScopes);
  return requestedScopesForTier(tier).filter((scope) => available.has(scope));
}

// ---------------------------------------------------------------------------
// Idle hygiene
// ---------------------------------------------------------------------------
//
// Default stale threshold per idle-is-not-abandoned. A token unused for 7+
// days is *suggested* stale in the UI — the operator still chooses whether
// to revoke it. This default absorbs Mark's travel + weekly rate-limit
// resets so paused work survives without triggering churn.
//
// Lives here (not in the "use server" actions file) because Next.js requires
// every export from a server-action module to be an async function.
export const MCP_TOKEN_DEFAULT_STALE_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/**
 * Derive idle-days from a lastUsedAt timestamp.
 *
 * - Returns `null` for tokens that have never been used (no lastUsedAt).
 * - Returns `0` when last-used is at-or-after `now` (clock-skew safety —
 *   never report a negative idle).
 * - Floors fractional days so a 6.5-day-old token reads as 6 (not 7) and
 *   does not prematurely cross the stale threshold.
 *
 * `now` is injectable so callers can hold the clock steady across a batch.
 */
export function deriveIdleDays(
  lastUsedAt: Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!lastUsedAt) return null;
  const diff = now.getTime() - lastUsedAt.getTime();
  if (diff < 0) return 0;
  return Math.floor(diff / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Revoked-token archive window
// ---------------------------------------------------------------------------
//
// Revoked tokens stay in the DB so the ToolExecution audit FK chain isn't
// broken (per the BI design stance: "We hide them, we don't drop them").
// After this many days, they fall off the admin UI entirely — operator sees
// a clean list, but forensic replay via /platform/ai/authority can still
// surface them via raw queries against the McpApiToken table.
//
// 90 days mirrors the typical SOC 2 / similar audit retention window for
// access-control rotation evidence. Bump consciously — anything shorter
// risks hiding a token before an incident review uses it.
export const MCP_TOKEN_REVOKED_ARCHIVE_DAYS = 90;

/**
 * True when a revoked token is past the archive window and should be hidden
 * from the admin UI entirely. Returns false for active tokens (no
 * `revokedAt`) and for revoked tokens still within the window — those stay
 * visible (toggleable via the UI's "Show revoked" affordance).
 *
 * `now` is injectable so callers can hold the clock steady across a batch.
 */
export function isMcpTokenArchived(
  revokedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!revokedAt) return false;
  const ageMs = now.getTime() - revokedAt.getTime();
  return ageMs >= MCP_TOKEN_REVOKED_ARCHIVE_DAYS * MS_PER_DAY;
}

// ---------------------------------------------------------------------------
// Role-based token templates
// ---------------------------------------------------------------------------
//
// The coarse scope tier (read/write/admin) tells an auditor at a glance how
// dangerous a token is. The granular `scopes[]` array is what governedExecuteTool
// actually enforces. The templates below bundle the right grants for the
// common consumer of an MCP token — a development agent, a finance coworker,
// an HR coworker, etc — so issuance is a one-click role choice instead of a
// "tick 30 checkboxes correctly" exercise.
//
// Template grants are drawn from the existing TOOL_TO_GRANTS catalog
// (apps/web/lib/tak/agent-grants.ts). Adding a new grant string anywhere
// requires updating both that file and the relevant template here in the
// same commit.

export const MCP_TOKEN_TEMPLATE_CATEGORIES = [
  "admin",
  "development",
  "employee",
  "observer",
  "custom",
] as const;

export type McpTokenTemplateCategory =
  (typeof MCP_TOKEN_TEMPLATE_CATEGORIES)[number];

export const MCP_TOKEN_TEMPLATE_IDS = [
  "admin",
  "development",
  "employee_finance",
  "employee_hr",
  "employee_ea",
  "employee_marketing",
  "observer",
  "custom",
] as const;

export type McpTokenTemplateId = (typeof MCP_TOKEN_TEMPLATE_IDS)[number];

export type McpTokenTemplate = {
  id: McpTokenTemplateId;
  label: string;
  category: McpTokenTemplateCategory;
  tier: McpTokenScopeTier;
  description: string;
  grants: readonly string[];
};

export const CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS = [
  "architecture_read",
  "backlog_read",
  "backlog_write",
  "code_graph_read",
  "file_read",
  "spec_plan_read",
  "work_capsule_read",
  "work_capsule_write",
  "work_capsule_adopt",
  "sandbox_execute",
  "iac_execute",
] as const;

const DEVELOPMENT_TEMPLATE_GRANTS = [
  // Reads needed to navigate the codebase, specs, backlog, and architecture
  "architecture_read",
  "backlog_read",
  "code_graph_read",
  "file_read",
  "spec_plan_read",
  "work_capsule_read",
  "registry_read",
  "ea_graph_read",
  "thread_read",
  "deliberation_read",
  "release_plan_read",
  "agent_control_read",
  "telemetry_read",
  "portfolio_read",
  "document_read",
  "coworker_catalog_read",
  // Writes / actions for the build-studio + ship loop
  // `critique_capture` lets an external review session DRAFT a UX critique into
  // the design corpus (BI-52839DEA). Narrow on purpose: capture originally
  // required `registry_write`, which this template does not hold, so the tool
  // was unreachable from the surface it exists for. Granting registry_write
  // here would have come with eleven other registry tools; this grants exactly
  // the one capability, and the entry is still only ever agent-proposed —
  // never calibration-eligible until a founder attaches a verdict in the portal.
  "critique_capture",
  "backlog_write",
  "backlog_triage",
  "build_promote",
  "build_plan_write",
  "work_capsule_write",
  "work_capsule_adopt",
  "sandbox_execute",
  "iac_execute",
  "deployment_plan_create",
  "release_gate_create",
  "release_plan_create",
  "deliberation_create",
  "thread_write",
  "decision_record_create",
  "tool_evaluation_create",
  "document_write",
  "coworker_engagement_write",
] as const;

const EMPLOYEE_FINANCE_TEMPLATE_GRANTS = [
  "browser_drive",
  "financial_report_create",
  // Banking books loop (BI-DE27D34E, S-FIN): set up accounts, import statements,
  // categorize via rules, reconcile. A finance token holds both the read and the
  // write axis so a bookkeeper coworker can keep the books current.
  "banking_read",
  "banking_write",
  "registry_read",
  "document_read",
  "backlog_read",
  "thread_read",
] as const;

const EMPLOYEE_HR_TEMPLATE_GRANTS = [
  "consumer_read",
  "consumer_write",
  "policy_write",
  "registry_read",
  "document_read",
  "backlog_read",
  "thread_read",
] as const;

const EMPLOYEE_EA_TEMPLATE_GRANTS = [
  "ea_graph_read",
  "ea_graph_write",
  "architecture_read",
  "registry_read",
  "registry_write",
  "document_read",
  "document_write",
  "document_publish",
  "backlog_read",
  "thread_read",
] as const;

const EMPLOYEE_MARKETING_TEMPLATE_GRANTS = [
  "marketing_read",
  "marketing_write",
  "registry_read",
  "document_read",
  "web_search",
  "thread_read",
] as const;

const OBSERVER_TEMPLATE_GRANTS = [
  "architecture_read",
  "backlog_read",
  "code_graph_read",
  "file_read",
  "spec_plan_read",
  "work_capsule_read",
  "registry_read",
  "ea_graph_read",
  "thread_read",
  "deliberation_read",
  "release_plan_read",
  "agent_control_read",
  "telemetry_read",
  "document_read",
  "admin_read",
  "marketing_read",
  "consumer_read",
  "portfolio_read",
] as const;

// Admin is the union of every grant a development token plus every
// employee surface plus admin_*/policy_write/data_governance_validate.
// Built by combining the smaller templates so we do not maintain two lists.
const ADMIN_TEMPLATE_GRANTS = Array.from(
  new Set<string>([
    ...DEVELOPMENT_TEMPLATE_GRANTS,
    ...EMPLOYEE_FINANCE_TEMPLATE_GRANTS,
    ...EMPLOYEE_HR_TEMPLATE_GRANTS,
    ...EMPLOYEE_EA_TEMPLATE_GRANTS,
    ...EMPLOYEE_MARKETING_TEMPLATE_GRANTS,
    "admin_read",
    "admin_write",
    "data_governance_validate",
    "external_registry_search",
    "web_search",
    "registry_write",
    "document_publish",
  ]),
);

export const MCP_TOKEN_TEMPLATES: readonly McpTokenTemplate[] = [
  {
    id: "admin",
    label: "Admin",
    category: "admin",
    tier: "admin",
    description:
      "Full platform admin including admin_write, policy_write, and every employee surface. Use sparingly.",
    grants: ADMIN_TEMPLATE_GRANTS,
  },
  {
    id: "development",
    label: "Development",
    category: "development",
    tier: "write",
    description:
      "Coding agent: read code/specs/backlog, write backlog and workrooms, run sandbox, ship via Build Studio (sandbox_execute + iac_execute).",
    grants: DEVELOPMENT_TEMPLATE_GRANTS,
  },
  {
    id: "employee_finance",
    label: "Employee — Finance",
    category: "employee",
    tier: "write",
    description:
      "Finance employee or coworker: period summaries, financial reports, supporting registry/document reads.",
    grants: EMPLOYEE_FINANCE_TEMPLATE_GRANTS,
  },
  {
    id: "employee_hr",
    label: "Employee — HR",
    category: "employee",
    tier: "write",
    description:
      "HR employee or coworker: employee records, leave policy, supporting registry/document reads.",
    grants: EMPLOYEE_HR_TEMPLATE_GRANTS,
  },
  {
    id: "employee_ea",
    label: "Employee — Enterprise Architecture",
    category: "employee",
    tier: "write",
    description:
      "EA employee or coworker: read/write the EA graph, import/export ArchiMate, publish architecture documents.",
    grants: EMPLOYEE_EA_TEMPLATE_GRANTS,
  },
  {
    id: "employee_marketing",
    label: "Employee — Marketing",
    category: "employee",
    tier: "write",
    description:
      "Marketing employee or coworker: campaign briefs, SEO analysis, archetype refinement.",
    grants: EMPLOYEE_MARKETING_TEMPLATE_GRANTS,
  },
  {
    id: "observer",
    label: "Read-only observer",
    category: "observer",
    tier: "read",
    description:
      "Every *_read grant in the catalog. Safe default for analytics dashboards, audit, and external monitoring agents.",
    grants: OBSERVER_TEMPLATE_GRANTS,
  },
  {
    id: "custom",
    label: "Custom",
    category: "custom",
    tier: "read",
    description:
      "Pick individual scopes manually. Use when none of the role templates fit.",
    grants: [],
  },
];

export function getMcpTokenTemplate(id: string): McpTokenTemplate | undefined {
  return MCP_TOKEN_TEMPLATES.find((t) => t.id === id);
}

// Filter a template's grants down to what the install actually exposes.
// Mirrors defaultMcpTokenScopes: installs may not register every grant in
// every release, and we never want to issue a token that requests a scope
// the platform cannot honour.
export function resolveTemplateGrants(
  template: McpTokenTemplate,
  availableScopes: readonly string[],
): string[] {
  const available = new Set(availableScopes);
  return template.grants.filter((grant) => available.has(grant));
}

// ---------------------------------------------------------------------------
// CLI / headless issuance defaults
// ---------------------------------------------------------------------------
//
// The Admin UI's "Issue write token" routes through the `development` role
// template (lib/actions/mcp-tokens.ts → issueMyWriteMcpToken). The headless
// CLI (apps/web/scripts/issue-mcp-token.ts) and the contributor bootstrap MUST
// match — otherwise a CLI-issued write token lands under-granted, missing
// sandbox_execute / iac_execute / build_promote and the rest of the
// build-studio + ship loop a coding agent needs (and that
// CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS expects). That divergence is what
// left the first macOS contributor token unable to run Build Studio / ship.
//
// Maps a coarse tier to the role template a token of that tier should carry,
// resolved against what this install actually exposes. read has no richer
// template by default (a coding-agent read token stays conservative); write →
// development; admin → admin. Falls back to the coarse per-tier set (still
// availability-filtered) if the template registers no grants here, so the
// caller never issues an empty-scope token.
const TIER_DEFAULT_TEMPLATE: Partial<Record<McpTokenScopeTier, McpTokenTemplateId>> = {
  write: "development",
  admin: "admin",
};

export function templateScopesForTier(
  tier: McpTokenScopeTier,
  availableScopes: readonly string[],
): string[] {
  const templateId = TIER_DEFAULT_TEMPLATE[tier];
  if (templateId) {
    const template = getMcpTokenTemplate(templateId);
    const resolved = template ? resolveTemplateGrants(template, availableScopes) : [];
    if (resolved.length > 0) return resolved;
  }
  return defaultMcpTokenScopes(availableScopes, tier);
}
