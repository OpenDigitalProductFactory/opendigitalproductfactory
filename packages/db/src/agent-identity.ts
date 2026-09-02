// Single source of truth for an AI coworker's human-facing identity: a clean
// Title-Case displayName and a controlled-vocabulary kind, derived deterministically
// from the registry/seed name with targeted per-agent overrides.
//
// Used by the seed (both agent paths) and enforced by agent-identity.test.ts so that
// "names all over the place" (mixed casing, -agent / -specialist suffix muddle, vague
// labels) cannot recur. Consolidation design WS1:
// docs/superpowers/specs/2026-06-26-coworker-management-consolidation-design.md

/** Controlled vocabulary for Agent.kind — the role-type facet, rendered as a chip.
 *  Lowercase canonical (DPF strongly-typed string-enum convention); UI Title-cases. */
export const AGENT_KINDS = [
  "orchestrator",
  "specialist",
  "advisor",
  "engineer",
  "analyst",
  "coordinator",
] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** Trailing tokens that are noise on a coworker name (the "-agent" / "-specialist" muddle). */
const NOISE_SUFFIXES = new Set(["agent", "specialist"]);

/** Tokens rendered as all-caps acronyms rather than Title Case. */
const ACRONYMS = new Set([
  "soc", "coo", "hr", "ea", "ux", "qa", "ai", "it", "sbom", "iac",
  "crm", "ir", "da", "se", "fe", "kpi", "sre", "a2a", "msp",
]);

/** Per-agent overrides where deterministic derivation is wrong or too generic.
 *  Keyed by the stable agentId (AGT-*) and/or the slug handle so both seed paths hit it. */
export const AGENT_IDENTITY_OVERRIDES: Record<string, { displayName?: string; kind?: AgentKind }> = {
  "AGT-ORCH-000": { displayName: "COO", kind: "orchestrator" },
  "coo": { displayName: "COO", kind: "orchestrator" },
  "AGT-WS-BUILD": { displayName: "Build Lead", kind: "orchestrator" },
  "build-specialist": { displayName: "Build Lead", kind: "orchestrator" },
  "AGT-901": { displayName: "Solution Architect" },
  "architecture-agent": { displayName: "Solution Architect" },
  "AGT-WS-ADMIN": { displayName: "Platform Admin", kind: "coordinator" },
  "admin-assistant": { displayName: "Platform Admin", kind: "coordinator" },
  // Onboarding COO must Title-Case COO consistently (not "Onboarding Coo").
  "AGT-WS-ONBOARD": { displayName: "Onboarding COO" },
  "onboarding-coo": { displayName: "Onboarding COO" },
  "AGT-WS-FARM-RANCH": { displayName: "Farm & Ranch Steward" },
  "farm-ranch-steward": { displayName: "Farm & Ranch Steward" },
  // BI-29F07F46. Derivation tokenizes the slug `ea-architect` into "EA" (an
  // ACRONYM) + "Architect" = "EA Architect" — a name authored NOWHERE, which is
  // why grepping for it finds no origin. Meanwhile the seed name, the reviewer
  // prompts, the HR-300 role, the profession registry label and the
  // wsid-enterprise-architecture profile all say "Enterprise Architect". The
  // roster was the odd one out, so an operator saw "EA Architect" in the portal
  // and "Enterprise Architect" in Docker Desktop's model requests and could not
  // tell they were one coworker. Converge on the name eight other homes already
  // use rather than propagating the derived one.
  "AGT-WS-EA": { displayName: "Enterprise Architect" },
  "ea-architect": { displayName: "Enterprise Architect" },
  // Two distinct registry agents both derived to "Portfolio Backlog" after
  // noise-suffix strip — keep them legibly distinct on the roster (BI-74FD6420).
  "AGT-102": { displayName: "Portfolio Backlog Manager" },
  "AGT-S2P-PFB": { displayName: "Portfolio Backlog Specialist" },
};

/**
 * Coworker slug handles (legacy seed `agentId` / `slugId`) → canonical registry
 * `agentId` (AGT-*). Dual seed paths create BOTH rows, so the AI Workforce
 * roster would show two COO / Build Lead / Platform Admin / etc. while
 * naming-health still reads clean (same displayName on both). BI-74FD6420.
 *
 * IMPORTANT: slug agentId rows remain first-class seed identities — many FK
 * consumers key `Agent.agentId` by slug (`CoworkerService.providerAgentId`,
 * hive-scout scheduled task, agent-model-defaults, skill assignTo). Do NOT
 * retire slug rows in seed until those consumers are remapped. Roster display
 * collapses dual-seed pairs via `dropDualSeedAliasAgents` (prefer AGT-*).
 */
export const COWORKER_SLUG_TO_CANONICAL_AGENT_ID: Readonly<Record<string, string>> = {
  "evaluate-orchestrator": "AGT-ORCH-100",
  "explore-orchestrator": "AGT-ORCH-200",
  "integrate-orchestrator": "AGT-ORCH-300",
  "deploy-orchestrator": "AGT-ORCH-400",
  "release-orchestrator": "AGT-ORCH-500",
  "consume-orchestrator": "AGT-ORCH-600",
  "operate-orchestrator": "AGT-ORCH-700",
  "governance-orchestrator": "AGT-ORCH-800",
  "finance-agent": "AGT-900",
  coo: "AGT-ORCH-000",
  "build-specialist": "AGT-WS-BUILD",
  "change-reviewer": "AGT-WS-REVIEW",
  "admin-assistant": "AGT-WS-ADMIN",
  "portfolio-advisor": "AGT-WS-PORTFOLIO",
  "external-catalog-scout": "AGT-WS-SCOUT",
  "inventory-specialist": "AGT-WS-INVENTORY",
  "ea-architect": "AGT-WS-EA",
  "hr-specialist": "AGT-WS-HR",
  "time-off-advisor": "AGT-WS-TIME-OFF",
  "customer-advisor": "AGT-WS-CUSTOMER",
  "marketing-specialist": "AGT-WS-MARKETING",
  "ops-coordinator": "AGT-WS-OPS",
  "platform-engineer": "AGT-WS-PLATFORM",
  "onboarding-coo": "AGT-WS-ONBOARD",
  // BI-6A1BFE77: UX Design Critic was established as AGT-906 (commit 24abf01c9)
  // but ALSO dual-seeded under its slug, and the slug was never added here — so
  // both rows rendered as a visible duplicate in the live roster (the exact
  // "manually-maintained map drifts" failure the BI names). The seed-integrity
  // guard (dual-seed-coverage) now fails the build on any future uncovered pair.
  "ux-design-critic": "AGT-906",
  "farm-ranch-steward": "AGT-WS-FARM-RANCH",
  // BI-620EBA53: the compliance coworker was roster-only, so it inherited no
  // canonical record — and therefore no escalation target, which is what the
  // Governance plane needs to reach level 3.
  "compliance-officer": "AGT-WS-COMPLIANCE",
  // EP-32B0E693: workforce-seeded coworkers are canonical identities, not a
  // second namespace. These mirrors preserve the slug rows required by legacy
  // FK consumers while collapsing the roster onto the AGT-* registry.
  "data-architect": "AGT-WS-DATA-ARCHITECT",
  "data-steward": "AGT-WS-DATA-STEWARD",
  dispatcher: "AGT-WS-DISPATCHER",
  "integration-engineer": "AGT-WS-INTEGRATION",
  "legal-operations-counsel": "AGT-WS-LEGAL",
  "security-engineer": "AGT-WS-SECURITY",
  "storefront-advisor": "AGT-WS-STOREFRONT",
  "finance-controller": "AGT-WS-FINANCE",
  "market-research-analyst": "AGT-WS-MARKET-RESEARCH",
  "doc-specialist": "AGT-WS-DOC",
  // Already-active registry identities are staffed by definition. The
  // workforce seed projects that existing state; it does not activate a
  // declared-only role or widen authority.
  "licensing-specialist": "AGT-905",
  "ux-accessibility-agent": "AGT-903",
  "soc-triage-analyst": "AGT-SOC-TRIAGE",
  "soc-investigator": "AGT-SOC-INVESTIGATOR",
  "soc-threat-hunter": "AGT-SOC-HUNTER",
  "soc-incident-commander": "AGT-SOC-IR-LEAD",
  "external-claude-code": "AGT-EXT-CLAUDE",
  "external-codex": "AGT-EXT-CODEX",
  "external-grok": "AGT-EXT-GROK",
  bookkeeper: "AGT-907",
};

/** Reverse map: canonical AGT-* → preferred slug handle. */
export const CANONICAL_AGENT_ID_TO_COWORKER_SLUG: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(COWORKER_SLUG_TO_CANONICAL_AGENT_ID).map(([slug, canonical]) => [canonical, slug]),
  ),
);

/**
 * Resolve a slug or agentId to the canonical registry agentId when known.
 * Use for roster/display collapse — not as a substitute for seed FK remapping.
 */
export function resolveCanonicalAgentId(agentIdOrSlug: string): string {
  return COWORKER_SLUG_TO_CANONICAL_AGENT_ID[agentIdOrSlug] ?? agentIdOrSlug;
}

/** True when the id is a registry-style AGT-* identifier. */
export function isCanonicalRegistryAgentId(agentId: string): boolean {
  return /^AGT[-_]/i.test(agentId);
}

function titleCaseToken(tok: string): string {
  const lower = tok.toLowerCase();
  if (ACRONYMS.has(lower)) return lower.toUpperCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Derive a clean Title-Case display name from a registry agent_name or seed name. */
export function deriveAgentDisplayName(source: string): string {
  const tokens = source.trim().split(/[\s_-]+/).filter(Boolean);
  if (tokens.length === 0) return source.trim();
  const last = tokens[tokens.length - 1];
  // Drop a single trailing noise suffix (-agent / -specialist) when it isn't the only token.
  if (tokens.length > 1 && last && NOISE_SUFFIXES.has(last.toLowerCase())) {
    tokens.pop();
  }
  return tokens.map(titleCaseToken).join(" ");
}

/**
 * The ONE user-facing agent-attribution resolver (BI-90CC785C). Given any agentId
 * or slug, return the role-based display LABEL — override first, else Title-Case
 * derivation. No raw agentId should ever reach the UI: every surface that shows
 * "who" an AI coworker is routes through here, so there is a single source of truth
 * for the role label. Pure + client-safe. Never returns a human persona name
 * (the ratified role-only contract, BI-7D29937E).
 */
export function resolveAgentRoleLabel(agentIdOrSlug: string | null | undefined): string {
  if (!agentIdOrSlug || !agentIdOrSlug.trim()) return "an AI coworker";
  const raw = agentIdOrSlug.trim();
  const canonical = resolveCanonicalAgentId(raw);
  const override =
    AGENT_IDENTITY_OVERRIDES[raw]?.displayName ?? AGENT_IDENTITY_OVERRIDES[canonical]?.displayName;
  return override ?? deriveAgentDisplayName(raw);
}

/** Derive the role-kind from the name / id / tier. */
export function deriveAgentKind(source: string, agentId: string, tier?: string): AgentKind {
  const s = source.toLowerCase();
  if (tier === "orchestrator" || /(^|[-_])orch([-_]|$)/i.test(agentId) || s.endsWith("orchestrator")) {
    return "orchestrator";
  }
  if (s.endsWith("engineer")) return "engineer";
  if (s.endsWith("advisor")) return "advisor";
  if (s.endsWith("analyst")) return "analyst";
  if (s.endsWith("coordinator")) return "coordinator";
  return "specialist";
}

/** Coerce an arbitrary string to a valid AgentKind, defaulting to "specialist". */
export function normalizeKind(kind: string | null | undefined): AgentKind {
  const k = (kind ?? "").toLowerCase();
  return (AGENT_KINDS as readonly string[]).includes(k) ? (k as AgentKind) : "specialist";
}

export interface AgentIdentityInput {
  agentId: string;
  /** The registry agent_name or seed name. */
  name: string;
  slugId?: string | null;
  tier?: string;
  /** Explicit values authored in the registry (win over derivation). */
  displayName?: string | null;
  kind?: string | null;
}

export interface AgentIdentity {
  displayName: string;
  kind: AgentKind;
}

/** Resolve the canonical {displayName, kind} for an agent: explicit > override > derived. */
export function resolveAgentIdentity(input: AgentIdentityInput): AgentIdentity {
  const ov =
    AGENT_IDENTITY_OVERRIDES[input.agentId] ??
    (input.slugId ? AGENT_IDENTITY_OVERRIDES[input.slugId] : undefined) ??
    {};
  const displayName =
    ov.displayName ||
    (input.displayName && input.displayName.trim()) ||
    deriveAgentDisplayName(input.name);
  const kind = normalizeKind(
    ov.kind ?? input.kind ?? deriveAgentKind(input.name, input.agentId, input.tier),
  );
  return { displayName, kind };
}

/**
 * Canonical human-facing name for a coworker that must be named in code
 * authored before any Agent row is loaded — system prompts, static UI labels.
 *
 * Prefer `Agent.displayName` / `resolveAgentIdentity` whenever you have the
 * row. This exists so the places that CANNOT do a lookup still resolve through
 * this module instead of hardcoding a string, which is how one coworker came to
 * answer to two names across the roster, the reviewer prompts and the records
 * (BI-29F07F46). Returns null for an agent with no authored override, so a
 * caller must decide deliberately rather than silently inventing a name.
 */
export function canonicalDisplayNameFor(agentIdOrSlug: string): string | null {
  return AGENT_IDENTITY_OVERRIDES[agentIdOrSlug]?.displayName ?? null;
}

/** The chief-architect lens: the EA coworker's canonical id and name.
 *  Bound to AGENT_IDENTITY_OVERRIDES, so renaming the coworker there renames it
 *  in every prompt and label that references this constant. */
export const ENTERPRISE_ARCHITECT_AGENT_ID = "AGT-WS-EA";
export const ENTERPRISE_ARCHITECT_DISPLAY_NAME: string =
  AGENT_IDENTITY_OVERRIDES[ENTERPRISE_ARCHITECT_AGENT_ID]!.displayName!;

/** Title-case a kind for display (e.g. "orchestrator" → "Orchestrator"). */
export function formatAgentKind(kind: string): string {
  const k = normalizeKind(kind);
  return k.charAt(0).toUpperCase() + k.slice(1);
}
