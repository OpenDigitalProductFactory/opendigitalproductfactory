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

/**
 * Collapse dual-seed DUPLICATES only — the narrow sibling of
 * dropDualSeedAliasAgents above.
 *
 * A coworker seeded in BOTH its slug form and its canonical AGT-* form is ONE
 * identity. Any surface that lists agents and does not collapse them renders the
 * same coworker twice (BI-74FD6420). Several did: the agent identity page and the
 * proactivity roster both ran a bare agent.findMany.
 *
 * The difference from dropDualSeedAliasAgents matters. That one ALSO drops a
 * canonical row whose slug twin is absent, because the roster's job is to list
 * coworkers that are actually selectable. This one drops the slug row ONLY when
 * its canonical twin is present, so a declared agent that was never seeded under
 * a slug still appears. Use this on any surface that inventories agents rather
 * than offering them for selection.
 */
export function collapseDualSeedDuplicates<T extends { agentId: string }>(
  rows: T[],
  slugToCanonical: Readonly<Record<string, string>> = COWORKER_SLUG_TO_CANONICAL_AGENT_ID,
): T[] {
  const present = new Set(rows.map((r) => r.agentId));
  return rows.filter((r) => {
    const canonical = slugToCanonical[r.agentId];
    return !(canonical && canonical !== r.agentId && present.has(canonical));
  });
}

/**
 * Detect dual-seed pairs that survive the render collapse as visible duplicates
 * (BI-6A1BFE77). The collapse map (COWORKER_SLUG_TO_CANONICAL_AGENT_ID) is
 * belt-and-suspenders that must be MANUALLY maintained: a coworker seeded in
 * both its AGT-* form and its slug form whose slug was never added to the map
 * renders twice. This returns every displayName still held by more than one row
 * after the collapse — an EMPTY result is the invariant. Wire it against the
 * seeded workforce (dual-seed-coverage.pg.test.ts) so a future uncovered pair
 * fails the build instead of silently duplicating in the roster.
 *
 * Only `active` / `production` rows are considered — archived or non-production
 * twins never render in the roster, so they cannot be a visible duplicate.
 */
export function uncoveredDualSeedDisplayNames<
  T extends { agentId: string; displayName: string; status?: string; lifecycleStage?: string },
>(
  agents: T[],
  slugToCanonical: Readonly<Record<string, string>> = COWORKER_SLUG_TO_CANONICAL_AGENT_ID,
): string[] {
  const rendered = agents.filter(
    (a) =>
      (a.status === undefined || a.status === "active") &&
      (a.lifecycleStage === undefined || a.lifecycleStage === "production"),
  );
  const kept = dropDualSeedAliasAgents(rendered, slugToCanonical);
  const counts = new Map<string, number>();
  for (const a of kept) counts.set(a.displayName, (counts.get(a.displayName) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name).sort();
}
