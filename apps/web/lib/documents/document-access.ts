// Who may read a managed document (BI-957915CB). The one home of the rule.
//
// - accessScope "organization": readable across the organization.
// - any other scope ("restricted", or an unknown value, which fails closed):
//   readable only by the owner, the creator, or a principal holding a
//   DocumentAccessGrant whose expiresAt is null or still in the future.
//
// Callers add `readableDocumentWhere(viewer)` to their own query so lists,
// counts and search hits never include an unreadable document; a refused
// single read answers not-found, so a refusal never confirms existence.
// A viewer is always the PERSON: an MCP call resolves the acting user, never
// the coworker's own principal, so a shared coworker cannot carry one person's
// restricted documents to another.

import type { Prisma } from "@dpf/db";
import { resolvePrincipalRecordIdForSessionIdentity } from "@/lib/identity/principal-linking";

export const ORGANIZATION_ACCESS_SCOPE = "organization";
export const RESTRICTED_ACCESS_SCOPE = "restricted";

/** The person reading: the relational Principal.id documents reference, or null when unknown. */
export type DocumentViewer = { principalId: string | null };

export const ANONYMOUS_DOCUMENT_VIEWER: DocumentViewer = Object.freeze({ principalId: null });

/** Resolve a signed-in user to a document viewer. Read-only: never creates a principal. */
export async function resolveDocumentViewer(userId: string | null | undefined): Promise<DocumentViewer> {
  const id = userId?.trim();
  if (!id) return ANONYMOUS_DOCUMENT_VIEWER;
  const principalId = await resolvePrincipalRecordIdForSessionIdentity({ type: "admin", id }).catch(() => null);
  return { principalId: principalId ?? null };
}

/** The Prisma clause selecting exactly the documents this viewer may read. */
export function readableDocumentWhere(viewer: DocumentViewer, now: Date = new Date()): Prisma.DocumentWhereInput {
  const principalId = viewer.principalId;
  if (!principalId) return { accessScope: ORGANIZATION_ACCESS_SCOPE };
  return {
    OR: [
      { accessScope: ORGANIZATION_ACCESS_SCOPE },
      { ownerPrincipalId: principalId },
      { createdByPrincipalId: principalId },
      {
        accessGrants: {
          some: {
            principalId,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      },
    ],
  };
}

type AccessFacts = {
  accessScope: string;
  ownerPrincipalId?: string | null;
  createdByPrincipalId?: string | null;
  accessGrants?: ReadonlyArray<{ principalId: string | null; expiresAt: Date | null }>;
};

/** The same rule over a loaded row, for callers that already hold one. */
export function isDocumentReadable(document: AccessFacts, viewer: DocumentViewer, now: Date = new Date()): boolean {
  if (document.accessScope === ORGANIZATION_ACCESS_SCOPE) return true;
  const principalId = viewer.principalId;
  if (!principalId) return false;
  if (document.ownerPrincipalId === principalId || document.createdByPrincipalId === principalId) return true;
  return (document.accessGrants ?? []).some(
    (grant) => grant.principalId === principalId && (grant.expiresAt === null || grant.expiresAt.getTime() > now.getTime()),
  );
}

/**
 * Whether the viewer may change a document's scope or owner. On a restricted
 * document only its owner or creator may; an organization document's scope is
 * left to anyone who may write it, as before.
 */
export function canManageDocumentAccess(document: AccessFacts, viewer: DocumentViewer): boolean {
  if (document.accessScope === ORGANIZATION_ACCESS_SCOPE) return true;
  const principalId = viewer.principalId;
  if (!principalId) return false;
  return document.ownerPrincipalId === principalId || document.createdByPrincipalId === principalId;
}
