// Document collections (BI-957915CB, AC-DPF-5), built on the document models.
//
// Tags cannot be a folder: they are flat, lower-cased and carry no access of
// their own. So a collection is a managed Document of kind "collection" (its
// description is its content), and membership is a "contains"
// DocumentReference from the collection to the member. A collection is read
// under the same rule as any document, and listing its members goes through
// searchManagedDocuments with the viewer clause, so a member the viewer may
// not read is simply absent. No table of its own.

import { prisma } from "@dpf/db";
import { ORGANIZATION_ACCESS_SCOPE, RESTRICTED_ACCESS_SCOPE, readableDocumentWhere, type DocumentViewer } from "./document-access";
import {
  COLLECTION_DOCUMENT_KIND,
  COLLECTION_MEMBER_REF_TYPE,
  linkManagedDocuments,
  saveManagedDocument,
  searchManagedDocuments,
  type ManagedDocument,
} from "./document-store";

export { COLLECTION_DOCUMENT_KIND, COLLECTION_MEMBER_REF_TYPE };

type CollectionDb = Pick<typeof prisma, "document" | "documentReference">;

/** A collection the viewer may read, with its scope, or null (missing and unreadable look the same). */
export async function findReadableCollection(
  collectionId: string,
  viewer: DocumentViewer,
  db: CollectionDb = prisma,
): Promise<{ accessScope: string } | null> {
  return db.document.findFirst({
    where: { AND: [{ documentId: collectionId, documentKind: COLLECTION_DOCUMENT_KIND }, readableDocumentWhere(viewer)] },
    select: { accessScope: true },
  });
}

export async function isReadableCollection(collectionId: string, viewer: DocumentViewer, db: CollectionDb = prisma): Promise<boolean> {
  return (await findReadableCollection(collectionId, viewer, db)) !== null;
}

/** The collections this viewer may read, newest first. */
export async function listCollections(viewer: DocumentViewer): Promise<ManagedDocument[]> {
  return searchManagedDocuments({ documentKind: COLLECTION_DOCUMENT_KIND, viewer, limit: 100 });
}

export async function createCollection(input: {
  title: string;
  description?: string | null;
  accessScope?: string | null;
  viewer: DocumentViewer;
  actorPrincipalId: string | null;
}): Promise<ManagedDocument> {
  const title = input.title.trim();
  if (!title) throw new Error("A collection needs a name.");
  return saveManagedDocument({
    title: title.slice(0, 200),
    documentKind: COLLECTION_DOCUMENT_KIND,
    contentFormat: "text/markdown",
    contentText: input.description?.trim() || title,
    accessScope: input.accessScope === RESTRICTED_ACCESS_SCOPE ? RESTRICTED_ACCESS_SCOPE : ORGANIZATION_ACCESS_SCOPE,
    ownerPrincipalId: input.actorPrincipalId,
    createdByPrincipalId: input.actorPrincipalId,
    actorPrincipalId: input.actorPrincipalId,
    viewer: input.viewer,
  });
}

/** File a document the viewer may read in a collection the viewer may read. */
export async function fileIntoCollection(input: {
  collectionId: string;
  documentId: string;
  viewer: DocumentViewer;
  actorPrincipalId: string | null;
}): Promise<void> {
  if (!(await isReadableCollection(input.collectionId, input.viewer))) throw new Error(`Collection not found: ${input.collectionId}`);
  await linkManagedDocuments({
    sourceDocumentId: input.collectionId,
    targetDocumentId: input.documentId,
    refType: COLLECTION_MEMBER_REF_TYPE,
    actorPrincipalId: input.actorPrincipalId,
    viewer: input.viewer,
  });
}
