import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { normalizePrincipalSensitivities } from "@dpf/db/principal-sensitivity";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { can } from "@/lib/govern/permissions";

export type CoworkerDataAccessInput = {
  agentId: string;
  expected: string[];
  levels: string[];
  reason: string;
};

export class CoworkerDataAccessError extends Error {}

/** Shared by the page and mutation; login claims never decide current access. */
export async function coworkerDataAccessEditor(userId: string, db: Prisma.TransactionClient = prisma) {
  const human = await currentUserContext(userId, db);
  if (!human || !can(human, "manage_agents")) return null;
  const owner = await db.principalAlias.findFirst({
    where: { aliasType: "user", aliasValue: userId, issuer: "" },
    select: { principal: { select: { kind: true, status: true, sensitivityClearance: true } } },
  });
  return owner?.principal.kind === "human" && owner.principal.status === "active"
    ? owner.principal.sensitivityClearance : null;
}

/** Changes the existing authority record, never an OAuth token or room policy. */
export async function setCoworkerDataAccess(userId: string, input: CoworkerDataAccessInput) {
  if (!Array.isArray(input.levels) || !input.levels.length || !Array.isArray(input.expected)
    || !input.expected.length || typeof input.agentId !== "string"
    || typeof input.reason !== "string" || input.reason.trim().length < 10 || input.reason.length > 1000) {
    throw new CoworkerDataAccessError("Choose data access and explain why this coworker needs it.");
  }
  const levels = normalizePrincipalSensitivities(input.levels);
  const expected = normalizePrincipalSensitivities(input.expected);
  return prisma.$transaction(async (tx) => {
    const allowed = await coworkerDataAccessEditor(userId, tx);
    if (!allowed) throw new CoworkerDataAccessError("You need permission to manage coworkers.");
    if (!levels.every((level) => allowed.includes(level))) {
      throw new CoworkerDataAccessError("You can only assign levels within your own data access.");
    }
    const agent = await tx.agent.findUnique({ where: { agentId: input.agentId }, select: { status: true, archived: true } });
    const alias = await tx.principalAlias.findFirst({
      where: { aliasType: "agent", aliasValue: input.agentId, issuer: "" },
      select: { principal: { select: { id: true, kind: true, status: true, sensitivityClearance: true } } },
    });
    if (!agent || agent.status !== "active" || agent.archived || alias?.principal.kind !== "agent"
      || alias.principal.status !== "active") throw new CoworkerDataAccessError("Choose an active coworker with a linked identity.");

    const saved = await tx.principal.updateMany({
      where: { id: alias.principal.id, kind: "agent", status: "active", sensitivityClearance: { equals: expected } },
      data: { sensitivityClearance: levels },
    });
    if (saved.count !== 1) throw new CoworkerDataAccessError("Data access changed while you were editing. Refresh and review it again.");
    await tx.authorizationDecisionLog.create({ data: {
      decisionId: `ADL-${randomUUID()}`, actorType: "human", actorRef: userId,
      humanContextRef: userId, agentContextRef: input.agentId,
      actionKey: "coworker-data-access", objectRef: input.agentId, decision: "allow",
      rationale: { before: expected, after: levels, reason: input.reason.trim(), principalId: alias.principal.id },
      routeContext: "/platform/identity/agents",
    } });
    return { levels };
  }, { isolationLevel: "Serializable" });
}
