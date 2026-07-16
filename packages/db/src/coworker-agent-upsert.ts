// packages/db/src/coworker-agent-upsert.ts
//
// BI-3073F13B: seedCoworkerAgents upserts each coworker Agent keyed on
// `agentId`, but the create branch writes `slugId`, which carries its own
// `@unique` (Agent_slugId_key). When a NEW agentId re-uses a slugId already held
// by a DIFFERENT agentId (a rename / re-registration), the upsert misses on
// agentId, takes the create path, and the slugId unique throws P2002 — which,
// because seedCoworkerAgents runs OUTSIDE a transaction, propagates and aborts
// the rest of the boot seed. This is the exact failure class already hardened
// for the geographic seeds (seedRegionOnce / seedCityOnce, BI-E4E21A7F: an
// unguarded seed P2002 crashed mid-run and downstream seeds never executed).
//
// Recovery: on the slugId collision, re-resolve the canonical row BY slugId and
// apply the coworker's update fields to it. The established slug identity is
// canonical — most surfaces FK Agent by slug (CoworkerService.providerAgentId,
// hive scout task, agent-model-defaults), and the AI Workforce roster already
// collapses dual-seed twins via dropDualSeedAliasAgents (BI-74FD6420). So one
// slugId keeps exactly one row, the coworker's latest data is applied, and the
// seed never crashes. Anything that is NOT a resolvable slug collision is
// re-thrown, so genuine bugs still surface.

import type { PrismaClient, Prisma } from "../generated/client/client";

export type CoworkerAgentUpsertOutcome = "upserted" | "reresolved_slug_collision";

export interface CoworkerAgentUpsertResult {
  id: string;
  agentId: string;
  outcome: CoworkerAgentUpsertOutcome;
}

/** True when err is a Prisma P2002 unique-constraint violation. */
function isP2002(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "P2002";
}

/**
 * Idempotently upsert one coworker Agent, tolerating the Agent_slugId_key
 * collision that arises when a new agentId re-uses an existing slugId. See the
 * file header (BI-3073F13B). Mirrors seedRegionOnce/seedCityOnce: try the write,
 * and on P2002 re-resolve the winning row rather than aborting the whole seed.
 * Never throws on a resolvable slugId collision; re-throws everything else.
 */
export async function upsertCoworkerAgentTolerant(
  client: PrismaClient,
  slugId: string,
  args: Prisma.AgentUpsertArgs,
): Promise<CoworkerAgentUpsertResult> {
  try {
    const agent = await client.agent.upsert(args);
    return { id: agent.id, agentId: agent.agentId, outcome: "upserted" };
  } catch (err: unknown) {
    // Prisma P2002 = unique-constraint violation. Anything else re-throws.
    if (!isP2002(err)) throw err;
    // The create branch collided on the slugId unique (a different agentId
    // already holds this slug). Re-resolve the canonical slug row and apply this
    // coworker's fields to it, so the seed stays complete without a duplicate
    // slug and without crashing the boot.
    const existing = await client.agent.findFirst({
      where: { slugId },
      select: { id: true, agentId: true },
    });
    // A P2002 that does not resolve to a slug owner is a different constraint —
    // surface it rather than swallowing a genuine bug.
    if (!existing) throw err;
    const updated = await client.agent.update({
      where: { id: existing.id },
      data: args.update,
    });
    return {
      id: updated.id,
      agentId: updated.agentId,
      outcome: "reresolved_slug_collision",
    };
  }
}
