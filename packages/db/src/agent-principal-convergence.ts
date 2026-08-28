/**
 * Principal convergence for agents (AGENTS.md §11).
 *
 * BI-53C26E60. The seed applied §11 to Users only. Agents arrive two ways —
 * `seedAgents` writes the 76 `AGT-*` roster rows from agent_registry.json, and
 * COWORKER_AGENT_SEEDS writes the parallel slug-id rows — and neither wrote a
 * Principal. Only `establish-coworker` and one bootstrap agent ever called
 * `syncAgentPrincipal`, so on a seeded install 71 of 76 `AGT-*` agents had no
 * identity at all.
 *
 * That is not cosmetic. `resolveReviewerIdentity` attributes a governed receipt
 * to the acting agent's principal and falls back to the delegating human when
 * the agent alias misses. With no alias it always missed, so every
 * `independent: true` lane — design-spec, spec-approval, architecture-review,
 * data-review, ux-fit-review, security-review, compliance-review,
 * domain-review, the archetype lanes — recorded the human as reviewer. The
 * human is the artifact author, which is the one identity independence
 * forbids, so those gates could never pass. That is bit-for-bit the failure
 * BI-72F368BC fixed in code; the code landed and the data never did.
 *
 * Inlined in packages/db rather than calling
 * apps/web/lib/identity/principal-linking.ts because the seed cannot depend on
 * apps/web. The row shape matches `syncAgentPrincipal` exactly so the runtime
 * self-heal path produces identical rows.
 */

import { resolvePrincipalSensitivityClearance } from "./principal-sensitivity.js";

/** Mirrors `normalizeGaidLocalId` in apps/web/lib/identity/principal-linking.ts. */
function normalizeGaidLocalId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "agent";
}

/** Mirrors `buildPrivateAgentGaid` in apps/web/lib/identity/principal-linking.ts. */
export function buildPrivateAgentGaid(agentId: string): string {
  return `gaid:priv:dpf.internal:${normalizeGaidLocalId(agentId)}`;
}

export type ConvergeableAgent = { agentId: string; name: string; status: string | null };

/** The narrow slice of the client this needs, so tests can pass a fake. */
export type AgentPrincipalDb = {
  agent: {
    findMany: (args: {
      where: { archived: boolean };
      select: { agentId: true; name: true; status: true };
    }) => Promise<ConvergeableAgent[]>;
  };
  principalAlias: {
    findMany: (args: {
      where: { aliasType: { in: string[] }; issuer: string };
      select: { aliasType: true; aliasValue: true };
    }) => Promise<Array<{ aliasType: string; aliasValue: string }>>;
    create: (args: {
      data: { principalId: string; aliasType: string; aliasValue: string; issuer: string };
    }) => Promise<unknown>;
  };
  principal: {
    create: (args: {
      data: {
        principalId: string;
        kind: string;
        status: string;
        displayName: string;
        sensitivityClearance: string[];
      };
    }) => Promise<{ id: string; principalId: string }>;
  };
};

export type AgentPrincipalConvergenceResult = {
  /** Non-archived agents examined. */
  examined: number;
  /** Agents that had no `aliasType:"agent"` alias and were given a Principal. */
  converged: string[];
};

/**
 * Give every non-archived agent exactly one agent-aliased Principal.
 *
 * Idempotent: an agent that already has an `aliasType:"agent"` alias is left
 * untouched, including its clearance, so re-running changes nothing. Only the
 * absent case is created, and it is created whole — the agent alias and the
 * private GAID alias together, because a principal reachable by one key and not
 * the other is the same silent-miss bug in a different place.
 */
export async function convergeAgentPrincipals(
  db: AgentPrincipalDb,
  newPrincipalId: () => string,
): Promise<AgentPrincipalConvergenceResult> {
  const agents = await db.agent.findMany({
    where: { archived: false },
    select: { agentId: true, name: true, status: true },
  });
  // (aliasType, aliasValue, issuer) is unique, so both key spaces have to be
  // read. An agent with a stranded GAID alias and no agent alias is exactly the
  // shape that would make a blind create throw mid-reconciliation.
  const existing = await db.principalAlias.findMany({
    where: { aliasType: { in: ["agent", "gaid"] }, issuer: "" },
    select: { aliasType: true, aliasValue: true },
  });
  const haveIdentity = new Set(
    existing.filter((row) => row.aliasType === "agent").map((row) => row.aliasValue),
  );
  const takenGaids = new Set(
    existing.filter((row) => row.aliasType === "gaid").map((row) => row.aliasValue),
  );

  const converged: string[] = [];
  for (const agent of agents) {
    if (haveIdentity.has(agent.agentId)) continue;
    const principal = await db.principal.create({
      data: {
        principalId: newPrincipalId(),
        kind: "agent",
        status: agent.status ?? "active",
        displayName: agent.name,
        // NOT []. `upsertPrincipalForAliases` runs a new principal's clearance
        // through resolvePrincipalSensitivityClearance, and an empty list
        // normalises to ["public"] — the floor every existing agent principal
        // already carries. Writing [] would leave these agents with no
        // clearance at all while looking like a faithful copy.
        sensitivityClearance: resolvePrincipalSensitivityClearance({
          existing: null,
          isSuperuser: false,
        }),
      },
    });
    const gaid = buildPrivateAgentGaid(agent.agentId);
    const aliases = [{ aliasType: "agent", aliasValue: agent.agentId }];
    // Two agent ids can normalise to one GAID. The agent alias is what the
    // reviewer lookup reads, so it is always written; the GAID is written only
    // when it is free, and skipping it never costs the agent its identity.
    if (!takenGaids.has(gaid)) aliases.push({ aliasType: "gaid", aliasValue: gaid });
    for (const alias of aliases) {
      await db.principalAlias.create({
        data: { principalId: principal.id, ...alias, issuer: "" },
      });
    }
    haveIdentity.add(agent.agentId);
    takenGaids.add(gaid);
    converged.push(agent.agentId);
  }
  return { examined: agents.length, converged };
}
