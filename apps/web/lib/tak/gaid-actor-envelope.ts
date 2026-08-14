import { prisma } from "@dpf/db";

import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute";

export type GaidActorEnvelope = {
  principalId: string;
  gaid: string;
  actorKind: "owner" | "employee" | "coworker" | "human";
  actorRef: string;
};

export type GaidActorResolver = (args: GovernedExecuteArgs) => Promise<GaidActorEnvelope | null>;

let resolverOverride: GaidActorResolver | null = null;
export function setGaidActorResolverOverrideForTests(override: GaidActorResolver | null): void {
  resolverOverride = override;
}

export async function resolveGaidActorEnvelope(args: GovernedExecuteArgs): Promise<GaidActorEnvelope | null> {
  if (resolverOverride) return resolverOverride(args);
  const actorAlias = args.context?.agentId
    ? { aliasType: "agent", aliasValue: args.context.agentId, issuer: "" }
    : { aliasType: "user", aliasValue: args.userId, issuer: "" };
  const alias = await prisma.principalAlias.findFirst({
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
  if (!alias?.principal.principalId || !gaid) return null;
  const employee = alias.principal.aliases.find((entry) => entry.aliasType === "employee")?.aliasValue;
  const owner = !args.context?.agentId && args.userContext.platformRole?.toLowerCase() === "ceo";
  return {
    principalId: alias.principal.principalId,
    gaid,
    actorKind: args.context?.agentId ? "coworker" : owner ? "owner" : employee ? "employee" : "human",
    actorRef: args.context?.agentId ?? employee ?? args.userId,
  };
}
