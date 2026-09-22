import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { can } from "@/lib/govern/permissions";
import { resolveWorkforcePlatformRole } from "@/lib/govern/auth-utils";
import type { PublicScope } from "./oauth-public-scopes";

type Db = Pick<Prisma.TransactionClient, "user" | "agent" | "authorityBinding">;
export const OAUTH_SETUP_REQUIRED =
  "Reconnect to approve an assistant role before starting work.";

export async function currentOAuthHuman(userId: string, db: Db = prisma) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true, isSuperuser: true, groups: { include: { platformRole: true } } },
  });
  if (!user?.isActive) return null;
  return { userId, isSuperuser: user.isSuperuser,
    platformRole: resolveWorkforcePlatformRole(user.groups) };
}

/** Human approval is authority. The client-provided app name is never queried. */
export async function eligibleOAuthCoworkers(
  userId: string, clientId: string, resource: string, db: Db = prisma,
  selection: { agentId?: string; after?: string } = {},
) {
  const human = await currentOAuthHuman(userId, db);
  if (!human) return [];
  // Administrators can explicitly delegate; everyone else needs an existing
  // approved delegation for this exact human/client/resource combination.
  const administrator = can(human, "manage_agents");
  return db.agent.findMany({
    where: { status: "active", archived: false,
      ...(selection.agentId ? { agentId: selection.agentId } : selection.after ? { agentId: { gt: selection.after } } : {}),
      toolGrants: { some: { grantKey: "work_room_write" } },
      ...(!administrator ? { authorityBindings: { some: {
        oauthPurpose: "delegation", oauthUserId: userId, oauthClientId: clientId,
        resourceRef: resource, status: "active",
      } } } : {}),
    },
    select: { id: true, agentId: true, displayName: true },
    orderBy: { agentId: "asc" },
    take: selection.agentId ? 1 : 51,
  });
}

export async function createOAuthConsentBinding(input: {
  userId: string; clientId: string; resource: string; agentId: string;
  scopes: PublicScope[];
}, db: Db) {
  const eligible = await eligibleOAuthCoworkers(input.userId, input.clientId, input.resource, db, { agentId: input.agentId });
  const agent = eligible.find((candidate) => candidate.agentId === input.agentId);
  if (!agent) throw new Error(OAUTH_SETUP_REQUIRED);
  return db.authorityBinding.create({ data: {
    bindingId: `AB-OAUTH-${randomUUID()}`,
    name: "Approved assistant connection", scopeType: "resource",
    resourceType: "mcp", resourceRef: input.resource, status: "active",
    oauthPurpose: "consent", oauthUserId: input.userId, oauthClientId: input.clientId,
    appliedAgentId: agent.id,
    grants: { create: input.scopes.map((grantKey) => ({ grantKey, mode: "allow" })) },
  } });
}

export async function resolveOAuthConsent(input: {
  bindingId: string; userId: string; clientId: string; resource: string;
  scopes: readonly string[];
}, db: Db = prisma): Promise<{ agentId: string; agentRecordId: string } | null> {
  const binding = await db.authorityBinding.findUnique({ where: { id: input.bindingId },
    include: { appliedAgent: true, grants: true } });
  if (!binding || binding.oauthPurpose !== "consent" || binding.status !== "active"
    || binding.oauthUserId !== input.userId || binding.oauthClientId !== input.clientId
    || binding.resourceRef !== input.resource || !binding.appliedAgent
    || binding.appliedAgent.status !== "active" || binding.appliedAgent.archived
    || !input.scopes.every((scope) => binding.grants.some((g) => g.grantKey === scope && g.mode === "allow"))) return null;
  const eligible = await eligibleOAuthCoworkers(input.userId, input.clientId, input.resource, db, { agentId: binding.appliedAgent.agentId });
  return eligible.some((agent) => agent.id === binding.appliedAgentId)
    ? { agentId: binding.appliedAgent.agentId, agentRecordId: binding.appliedAgent.id } : null;
}
