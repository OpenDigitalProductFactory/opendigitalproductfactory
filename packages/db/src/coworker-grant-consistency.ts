// packages/db/src/coworker-grant-consistency.ts
//
// EP-E431FC8A Phase 4 (BI-17ACD329). The coworker grant surface has TWO sources
// that agent-grants.ts resolves DB-first then JSON-fallback:
//   1. HARDCODED_COWORKER_GRANTS (workforce-seed.ts) — seeded into AgentToolGrant.
//   2. agent_registry.json tool_grants — the fallback for un-seeded installs.
// They have drifted per-agent (each side holds grants the other lacks), so which
// grant set is "correct" per agent is a GOVERNANCE decision, not a mechanical one
// (kernel: DI-D1C241BCCBF0 — recommend-only; escalating/removing authority is
// founder-governed). This module does not decide the correct set; it makes the
// drift VISIBLE and RATCHETED so no NEW divergence creeps in silently and the
// known drift is tracked for founder resolution.
//
// Pure — imports nothing from Prisma; unit-tests in the packages shard.

export interface GrantDivergence {
  agentId: string;
  /** Grants in the DB seed map but absent from the JSON registry. */
  onlyInSeed: string[];
  /** Grants in the JSON registry but absent from the DB seed map. */
  onlyInRegistry: string[];
}

interface RegistryAgent {
  agent_id?: string;
  agent_name?: string;
  config_profile?: { tool_grants?: string[] };
}

/**
 * Compare the DB-seed grant map against the JSON registry for every agent that
 * appears in the seed map. Returns one entry per DIVERGING agent (order = seed
 * map order). An agent absent from the registry, or with a different grant set,
 * diverges; identical sets are omitted.
 */
export function findGrantDivergences(
  hardcoded: Record<string, readonly string[]>,
  registryAgents: readonly RegistryAgent[],
): GrantDivergence[] {
  const byName = new Map<string, string[]>();
  for (const a of registryAgents) {
    const grants = a.config_profile?.tool_grants ?? [];
    if (a.agent_id) byName.set(a.agent_id, grants);
    if (a.agent_name) byName.set(a.agent_name, grants);
  }

  const out: GrantDivergence[] = [];
  for (const [agentId, seedGrantsRaw] of Object.entries(hardcoded)) {
    const seed = new Set(seedGrantsRaw);
    const registry = new Set(byName.get(agentId) ?? []);
    const onlyInSeed = [...seed].filter((g) => !registry.has(g)).sort();
    const onlyInRegistry = [...registry].filter((g) => !seed.has(g)).sort();
    if (!byName.has(agentId) || onlyInSeed.length > 0 || onlyInRegistry.length > 0) {
      out.push({ agentId, onlyInSeed, onlyInRegistry });
    }
  }
  return out;
}

/** The agentIds whose grant sources are known to diverge today. The guard test
 *  pins this list: a NEW divergence (an agentId not here) fails CI and must be
 *  reconciled; fixing an existing one requires removing it here — either way the
 *  drift stays visible and founder-governed, never silently growing. */
export const KNOWN_GRANT_DIVERGENCES: readonly string[] = [
  "admin-assistant",
  "build-specialist",
  // compliance-officer RESOLVED: it was roster-only, so its runtime grants had no
  // canonical record to agree with. Giving it AGT-WS-COMPLIANCE (BI-620EBA53)
  // reconciled the sources, so it leaves this list rather than being re-pinned —
  // the ratchet shrinking is the point.
  "coo",
  "ea-architect",
  "external-catalog-scout",
  // hr-specialist was reconciled (BI-3CDEC5F0): the seed and agent_registry now
  // carry the identical grant set, so it is no longer a tracked divergence.
  "inventory-specialist",
  "marketing-specialist",
  "ops-coordinator",
  "platform-engineer",
  "portfolio-advisor",
];
