// packages/db/src/neo4j-rebuild-documents.ts
// Rebuild the managed-document reference graph projection from Postgres.
// Usage: pnpm --filter @dpf/db neo4j:rebuild-documents

import "./load-env.js";
import { prisma } from "./client.js";
import { closeNeo4j, runCypher } from "./neo4j.js";
import { syncDocumentNode, syncDocumentReference } from "./neo4j-sync.js";

async function rebuildDocuments(): Promise<void> {
  console.log("Rebuilding managed document graph projection...");

  await runCypher(`MATCH (doc:Document) DETACH DELETE doc`, {});
  console.log("Dropped existing :Document nodes");

  const documents = await prisma.document.findMany({
    select: {
      documentId: true,
      title: true,
      currentState: true,
      documentKind: true,
    },
  });

  for (const document of documents) {
    await syncDocumentNode({
      documentId: document.documentId,
      title: document.title,
      currentState: document.currentState,
      documentKind: document.documentKind,
    });
  }
  console.log(`Synced ${documents.length} Document nodes`);

  const references = await prisma.documentReference.findMany({
    where: { targetDocumentId: { not: null } },
    include: {
      sourceDocument: { select: { documentId: true, title: true, currentState: true, documentKind: true } },
      targetDocument: { select: { documentId: true, title: true, currentState: true, documentKind: true } },
      sourceVersion: { select: { id: true } },
      targetVersion: { select: { id: true } },
    },
  });

  for (const reference of references) {
    if (!reference.targetDocument) continue;
    await syncDocumentReference({
      sourceDocumentId: reference.sourceDocument.documentId,
      sourceTitle: reference.sourceDocument.title,
      sourceState: reference.sourceDocument.currentState,
      sourceKind: reference.sourceDocument.documentKind,
      sourceVersionId: reference.sourceVersion?.id ?? reference.sourceVersionId,
      targetDocumentId: reference.targetDocument.documentId,
      targetTitle: reference.targetDocument.title,
      targetState: reference.targetDocument.currentState,
      targetKind: reference.targetDocument.documentKind,
      targetVersionId: reference.targetVersion?.id ?? reference.targetVersionId,
      refType: reference.refType,
      anchor: reference.anchor,
    });
  }
  console.log(`Synced ${references.length} DOC_REFERENCES edges`);

  console.log("Managed document graph rebuild complete.");
}

rebuildDocuments()
  .catch(console.error)
  .finally(() => Promise.all([prisma.$disconnect(), closeNeo4j()]));
