// Coworker backlog-scope resolver — BI-474A1F55.
//
// Resolves the acting coworker's own slice of the backlog from its identity
// (never from a caller-supplied scope argument), so a coworker sees only the
// BacklogItems for its surface (portfolio / taxonomy area), its occupation
// (capabilities in its IT4IT value stream) and anything it owns or claimed.
// The union is expressed as Prisma where-OR clauses; the handler ANDs its
// status / workType narrowing on top. Enforcement is by identity: there is no
// scope argument to widen, so a coworker cannot enumerate another portfolio.

import { professionKeyFromRole } from "@/lib/decision-perspective/resolve-profession-profile";

/** Reads the acting coworker's agentId from MCP tool context; throws if absent. */
export function requireCurrentCoworker(context?: { agentId?: string }): string {
  const agentId = context?.agentId?.trim();
  if (!agentId) {
    throw new Error("A current coworker agentId is required for this tool.");
  }
  return agentId;
}

export interface CoworkerBacklogScope {
  agentId: string;
  portfolioId: string | null;
  valueStream: string | null;
  professionKey: string | null;
  /** True when the occupation (value-stream capability) arm contributed a clause. */
  occupationArmApplied: boolean;
  /** Prisma BacklogItem where-OR clauses defining this coworker's slice. */
  orClauses: Record<string, unknown>[];
}

/**
 * Build the identity-scoped BacklogItem filter for a coworker. The returned
 * `orClauses` are the union of three arms:
 *   - owned/claimed (always) — never hide work the coworker is accountable for;
 *   - surface/area — the coworker's portfolio node + any BI whose taxonomy node
 *     rolls up to that portfolio;
 *   - occupation — BIs trace-linked to a business capability in the coworker's
 *     value stream, skipped (and flagged via `occupationArmApplied=false`) when
 *     the coworker has no discriminating value stream so the slice degrades to
 *     area+owned rather than erroring.
 */
export async function resolveCoworkerBacklogScope(
  agentId: string,
  _routeContext?: string | null,
): Promise<CoworkerBacklogScope> {
  const { prisma } = await import("@dpf/db");
  const agent = await prisma.agent.findFirst({
    where: { OR: [{ agentId }, { slugId: agentId }] },
    select: { agentId: true, slugId: true, portfolioId: true, valueStream: true },
  });

  const portfolioId = agent?.portfolioId ?? null;
  const valueStream = agent?.valueStream ?? null;
  const professionKey =
    professionKeyFromRole(agentId) ??
    (agent?.slugId ? professionKeyFromRole(agent.slugId) : null);

  const orClauses: Record<string, unknown>[] = [
    // Owned / claimed — always folded in so a coworker never loses sight of
    // work it is accountable for, even outside its portfolio area.
    { agentId },
    { claimedByAgentId: agentId },
  ];

  // Surface / area — the coworker's portfolio node and any BI whose taxonomy
  // node rolls up to that portfolio.
  if (portfolioId) {
    orClauses.push({ portfolioId });
    orClauses.push({ taxonomyNode: { portfolioId } });
  }

  // Occupation — BIs trace-linked to a business capability in the coworker's
  // IT4IT value stream.
  let occupationArmApplied = false;
  if (valueStream && valueStream !== "cross-cutting") {
    occupationArmApplied = true;
    orClauses.push({
      businessCapabilityLinks: {
        some: { capability: { it4itValueStreams: { has: valueStream } } },
      },
    });
  }

  return { agentId, portfolioId, valueStream, professionKey, occupationArmApplied, orClauses };
}
