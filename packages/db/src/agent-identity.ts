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
};

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

/** Title-case a kind for display (e.g. "orchestrator" → "Orchestrator"). */
export function formatAgentKind(kind: string): string {
  const k = normalizeKind(kind);
  return k.charAt(0).toUpperCase() + k.slice(1);
}
