// BI-A63A9476: build the reference reader for the caller (spec 2026-10-14 §2 R2).
//
// A person reads with their own capabilities and clearance in their own
// organization. A coworker reads with the intersection of its grants and its
// operator's: its corpus scope (BI-825D3487), the clearance both hold, and the
// operator's document viewer (documents are always read as the person).

import { prisma } from "@dpf/db";

import { resolveDocumentViewer } from "@/lib/documents/document-access";
import { resolvePrincipalRecordIdForSessionIdentity } from "@/lib/identity/principal-linking";
import { can, type UserContext } from "@/lib/permissions";
import { PERSON_CORPUS_SCOPE, resolveCorpusReadScope } from "@/lib/tak/corpus-read-scope";
import { resolveReaderOrganizationId } from "@/lib/wiki/reader-organization";
import { resolveAgentWorkroomAccess, resolveHumanWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";

import type { ReferenceReadDb, ReferenceReadDeps, ReferenceReader } from "./read-references";

async function personClearance(userId: string): Promise<string[]> {
  const principalId = await resolvePrincipalRecordIdForSessionIdentity({ type: "admin", id: userId }).catch(() => null);
  if (!principalId) return ["public"];
  const row = await prisma.principal.findUnique({ where: { id: principalId }, select: { sensitivityClearance: true } });
  return (row?.sensitivityClearance as string[] | undefined) ?? ["public"];
}

async function agentClearance(agentId: string): Promise<string[]> {
  const alias = await prisma.principalAlias.findFirst({
    where: { aliasType: "agent", aliasValue: agentId, issuer: "" },
    select: { principal: { select: { sensitivityClearance: true } } },
  });
  return (alias?.principal.sensitivityClearance as string[] | undefined) ?? ["public"];
}

/** The reader for a signed-in person. */
export async function personReferenceReader(user: { id: string } & UserContext): Promise<ReferenceReader> {
  const [organizationId, clearance, documentViewer] = await Promise.all([
    resolveReaderOrganizationId(prisma),
    personClearance(user.id),
    resolveDocumentViewer(user.id),
  ]);
  return {
    kind: "person",
    userId: user.id,
    agentId: null,
    organizationId,
    corpus: PERSON_CORPUS_SCOPE,
    canReadBacklog: can(user, "view_operations"),
    clearance: new Set(clearance),
    documentViewer,
  };
}

/**
 * The reader for a coworker acting for `userId`. `canReadBacklog` is the
 * caller's: a tool gated on `backlog_read` and the operator's capability has
 * already established it.
 */
export async function agentReferenceReader(input: { userId: string; agentId: string; canReadBacklog: boolean }): Promise<ReferenceReader> {
  const [organizationId, corpus, operator, agent, documentViewer] = await Promise.all([
    resolveReaderOrganizationId(prisma),
    resolveCorpusReadScope(input.agentId),
    personClearance(input.userId),
    agentClearance(input.agentId),
    resolveDocumentViewer(input.userId),
  ]);
  const held = new Set(operator);
  return {
    kind: "agent",
    userId: input.userId,
    agentId: input.agentId,
    organizationId,
    corpus,
    canReadBacklog: input.canReadBacklog,
    clearance: new Set(agent.filter((level) => held.has(level))),
    documentViewer,
  };
}

/** Prisma plus room admission at `content` for this reader. */
export function referenceReadDeps(reader: ReferenceReader): ReferenceReadDeps {
  return {
    db: prisma as unknown as ReferenceReadDb,
    canReadRoom: async (workroomId) => {
      if (!reader.userId) return false;
      const access = reader.agentId
        ? await resolveAgentWorkroomAccess({ userId: reader.userId, agentId: reader.agentId, workroomId, requested: "content" })
        : await resolveHumanWorkroomAccess({ userId: reader.userId, workroomId, requested: "content" });
      return access.decision.level === "content";
    },
  };
}
