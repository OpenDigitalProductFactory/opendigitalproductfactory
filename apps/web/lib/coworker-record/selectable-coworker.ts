import {
  CANONICAL_AGENT_ID_TO_COWORKER_SLUG,
  COWORKER_SLUG_TO_CANONICAL_AGENT_ID,
  resolveCanonicalAgentId,
} from "@dpf/db/agent-identity";

export const SELECTABLE_COWORKER_STATE = {
  status: "active",
  archived: false,
  lifecycleStage: "production",
} as const;

export function selectableCoworkerIdentityRefs(requestedRef: string): {
  canonicalAgentId: string;
  runtimeAgentId: string;
} {
  const canonicalAgentId = resolveCanonicalAgentId(requestedRef);
  return {
    canonicalAgentId,
    runtimeAgentId:
      CANONICAL_AGENT_ID_TO_COWORKER_SLUG[canonicalAgentId] ??
      canonicalAgentId,
  };
}

/**
 * Keep one display row only when the full canonical + executable identity pair
 * is selectable (BI-74FD6420). Known slug rows never render independently:
 * their detail route canonicalizes to AGT-* and execution still uses the slug,
 * so an orphan on either side cannot complete the roster's primary job.
 *
 * Lives here, beside SELECTABLE_COWORKER_STATE, because the two together ARE
 * the selection contract the coworker detail route enforces: any roster that
 * deep-links to /platform/ai/agent/[agentId] must apply BOTH or it renders
 * rows whose links 404.
 */
export function dropDualSeedAliasAgents<T extends { agentId: string }>(
  agents: T[],
  slugToCanonical: Readonly<Record<string, string>> = COWORKER_SLUG_TO_CANONICAL_AGENT_ID,
): T[] {
  const present = new Set(agents.map((a) => a.agentId));
  const canonicalToSlug = new Map(
    Object.entries(slugToCanonical).map(([slug, canonical]) => [
      canonical,
      slug,
    ]),
  );
  return agents.filter((a) => {
    const canonical = slugToCanonical[a.agentId];
    if (canonical && canonical !== a.agentId) return false;
    const runtimeSlug = canonicalToSlug.get(a.agentId);
    if (runtimeSlug && !present.has(runtimeSlug)) return false;
    return true;
  });
}
