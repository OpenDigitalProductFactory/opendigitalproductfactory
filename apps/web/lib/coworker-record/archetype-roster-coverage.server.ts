import "server-only";

import { prisma } from "@dpf/db";
import { ALL_ARCHETYPES, deriveRequiredRoster } from "@dpf/storefront-templates";

import {
  measureRosterCoverage,
  requiredCoverageSlugs,
  type RosterCoverage,
} from "./archetype-roster-coverage";
import { SELECTABLE_COWORKER_STATE, dropDualSeedAliasAgents } from "./selectable-coworker";

export type RosterCoverageDb = {
  storefrontConfig: {
    findFirst: (args: unknown) => Promise<{ archetype: { archetypeId: string } | null } | null>;
  };
  agent: {
    findMany: (args: unknown) => Promise<Array<{ agentId: string }>>;
  };
};

/**
 * Coverage for this install: the active storefront archetype's derived roster
 * union the nine platform orchestrators, compared to selectable production
 * coworkers. StorefrontConfig.archetypeId is the StorefrontArchetype row id;
 * the slug lives on StorefrontArchetype.archetypeId.
 */
export async function loadArchetypeRosterCoverage(
  db: RosterCoverageDb = prisma as RosterCoverageDb,
): Promise<RosterCoverage> {
  const storefront = await db.storefrontConfig.findFirst({
    select: { archetype: { select: { archetypeId: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const archetypeSlug = storefront?.archetype?.archetypeId ?? null;
  const definition = archetypeSlug
    ? ALL_ARCHETYPES.find((leaf) => leaf.archetypeId === archetypeSlug) ?? null
    : null;
  const rosterSlugs = definition
    ? deriveRequiredRoster(definition).map((role) => role.agentSlug)
    : [];
  const agents = dropDualSeedAliasAgents(
    await db.agent.findMany({
      where: SELECTABLE_COWORKER_STATE,
      select: { agentId: true },
    }),
  );
  const measured = measureRosterCoverage({
    required: requiredCoverageSlugs(rosterSlugs),
    staffed: agents.map((row) => row.agentId),
  });
  return {
    archetypeId: definition?.archetypeId ?? null,
    ...measured,
  };
}
