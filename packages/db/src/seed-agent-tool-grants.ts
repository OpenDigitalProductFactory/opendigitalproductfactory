import { CANONICAL_AGENT_ID_TO_COWORKER_SLUG, resolveCanonicalAgentId } from "./agent-identity.js";

export interface SeedAgentPermissionState {
  agentId: string;
  name: string;
  type: string;
  _count: { toolGrants: number; toolGrantRevocations: number };
}

export async function assertInteractiveAgentPermissionState(db: {
  agent: { findMany(input: { where: { archived: false }; select: {
    agentId: true; name: true; type: true;
    _count: { select: { toolGrants: true; toolGrantRevocations: true } };
  } }): Promise<SeedAgentPermissionState[]> };
}): Promise<void> {
  const agents = await db.agent.findMany({
    where: { archived: false },
    select: { agentId: true, name: true, type: true,
      _count: { select: { toolGrants: true, toolGrantRevocations: true } } },
  });
  const byId = new Map(agents.map(agent => [agent.agentId, agent]));
  const hasState = (agent: SeedAgentPermissionState) =>
    agent._count.toolGrants > 0 || agent._count.toolGrantRevocations > 0;
  const missing = agents.filter(agent => {
    if (!["coworker", "onboarding"].includes(agent.type)) return false;
    const ownerId = resolveCanonicalAgentId(agent.agentId);
    const owner = byId.get(ownerId);
    if (!owner) return true;
    const alias = byId.get(CANONICAL_AGENT_ID_TO_COWORKER_SLUG[ownerId]);
    // Empty aliases are expected. Explicit removals and unresolved alias
    // assertions are intentional states, not permission to seed more access.
    return !hasState(owner) && !(alias && hasState(alias));
  });
  if (missing.length) {
    throw new Error(`Seed invariant violated: interactive agents without permission state: ${
      missing.map(agent => `${agent.agentId} (${agent.name}; authority=${resolveCanonicalAgentId(agent.agentId)})`).join(", ")}. `
      + "Provision the canonical registry profile or reconcile its missing authority; do not add duplicate alias grants.");
  }
}

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
