import { CANONICAL_AGENT_ID_TO_COWORKER_SLUG, resolveCanonicalAgentId } from "./agent-identity.js";

export interface CanonicalGrantSeedDb {
  agent: {
    findUnique(input: { where: { agentId: string }; select: { _count: { select: { toolGrants: true; toolGrantRevocations: true } } } }):
      Promise<{ _count: { toolGrants: number; toolGrantRevocations: number } } | null>;
  };
  agentToolGrant: {
    upsert(input: { where: { agentId_grantKey: { agentId: string; grantKey: string } }; update: Record<string, never>;
      create: { agentId: string; grantKey: string } }): Promise<unknown>;
  };
}

/** Registry defaults fill missing canonical rows; live removals and pending decisions win. */
export async function seedCanonicalAgentToolGrants(
  db: CanonicalGrantSeedDb,
  agent: { id: string; agentId: string },
  grants: readonly string[],
  revokedGrants: ReadonlySet<string>,
): Promise<void> {
  if (resolveCanonicalAgentId(agent.agentId) !== agent.agentId) return;
  const aliasId = CANONICAL_AGENT_ID_TO_COWORKER_SLUG[agent.agentId];
  const previous = aliasId ? await db.agent.findUnique({ where: { agentId: aliasId },
    select: { _count: { select: { toolGrants: true, toolGrantRevocations: true } } } }) : null;
  // Migration empties safe aliases. Remaining assertions need human approval,
  // affecting only this identity; unrelated coworkers still converge normally.
  if (previous && (previous._count.toolGrants || previous._count.toolGrantRevocations)) return;
  for (const grantKey of grants) {
    if (revokedGrants.has(`${agent.id}:${grantKey}`)) continue;
    await db.agentToolGrant.upsert({
      where: { agentId_grantKey: { agentId: agent.id, grantKey } },
      update: {}, create: { agentId: agent.id, grantKey },
    });
  }
}
