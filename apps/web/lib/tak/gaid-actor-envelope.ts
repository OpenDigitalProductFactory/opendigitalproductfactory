import { prisma, type Prisma } from "@dpf/db";

import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute-types";

export type GaidActorEnvelope = {
  principalId: string;
  /** GAID identifies an AI-agent subject. Direct human actors remain bound to
   * their canonical Principal and MUST NOT receive a fabricated agent id. */
  gaid: string | null;
  actorKind: "owner" | "employee" | "coworker" | "human";
  actorRef: string;
};

export type GaidActorResolver = (args: GovernedExecuteArgs) => Promise<GaidActorEnvelope | null>;

let resolverOverride: GaidActorResolver | null = null;
export function setGaidActorResolverOverrideForTests(override: GaidActorResolver | null): void {
  resolverOverride = override;
}

/** `db` defaults to the shared client; the AC-PROBE runner passes a read-only transaction (BI-129EFFD1). */
export async function resolveGaidActorEnvelope(
  args: GovernedExecuteArgs,
  db: Pick<Prisma.TransactionClient, "principalAlias"> = prisma,
): Promise<GaidActorEnvelope | null> {
  if (resolverOverride) return resolverOverride(args);
  const actorAlias = args.context?.agentId
    ? { aliasType: "agent", aliasValue: args.context.agentId, issuer: "" }
    : { aliasType: "user", aliasValue: args.userId, issuer: "" };
  const alias = await db.principalAlias.findFirst({
    where: actorAlias,
    select: {
      principal: {
        select: {
          principalId: true,
          aliases: { where: { aliasType: { in: ["gaid", "employee"] } }, select: { aliasType: true, aliasValue: true } },
        },
      },
    },
  });
  const gaid = alias?.principal.aliases.find((entry) => entry.aliasType === "gaid")?.aliasValue;
  if (!alias?.principal.principalId) return null;
  // A coworker cannot act without its GAID identity. Humans are the delegating
  // principals in the GAID chain-of-custody and are identified by Principal.
  if (args.context?.agentId && !gaid) return null;
  const employee = alias.principal.aliases.find((entry) => entry.aliasType === "employee")?.aliasValue;
  const owner = !args.context?.agentId && args.userContext.platformRole?.toLowerCase() === "ceo";
  return {
    principalId: alias.principal.principalId,
    gaid: gaid ?? null,
    actorKind: args.context?.agentId ? "coworker" : owner ? "owner" : employee ? "employee" : "human",
    actorRef: args.context?.agentId ?? employee ?? args.userId,
  };
}
