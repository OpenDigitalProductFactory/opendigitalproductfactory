import { QDRANT_COLLECTIONS, searchSimilar, upsertVectors } from "@dpf/db";
import { generateEmbedding } from "@/lib/inference/embedding";

const ENTITY_TYPE = "document";
const MAX_EMBED_LENGTH = 8000;

export type StoreDocumentVectorInput = {
  id: string;
  documentId: string;
  documentVersionId: string;
  organizationId: string;
  title: string;
  documentKind: string;
  contentFormat: string;
  currentState: string;
  ownerPrincipalId: string | null;
  tags: string[];
  contentText: string | null;
  summary: string | null;
};

export type DocumentSemanticSearchInput = {
  query: string;
  organizationId?: string | null;
  currentState?: string | null;
  documentKind?: string | null;
  tags?: string[];
  limit?: number;
  scoreThreshold?: number;
};

export type DocumentSemanticSearchResult = {
  id: string;
  documentId: string;
  title: string;
  contentPreview: string;
  score: number;
};

export async function storeDocumentVector(input: StoreDocumentVectorInput): Promise<boolean> {
  const embeddingInput = [
    input.title,
    input.summary ?? "",
    input.contentText ?? "",
  ].filter(Boolean).join("\n\n").slice(0, MAX_EMBED_LENGTH);
  const vector = await generateEmbedding(embeddingInput);
  if (!vector) return false;

  await upsertVectors(QDRANT_COLLECTIONS.DOCUMENTS, [
    {
      id: `document-${input.id}`,
      vector,
      payload: {
        entityType: ENTITY_TYPE,
        entityId: input.id,
        documentId: input.documentId,
        documentVersionId: input.documentVersionId,
        organizationId: input.organizationId,
        title: input.title,
        documentKind: input.documentKind,
        contentFormat: input.contentFormat,
        currentState: input.currentState,
        ownerPrincipalId: input.ownerPrincipalId,
        tags: input.tags,
        contentPreview: (input.contentText ?? input.summary ?? "").slice(0, 500),
        timestamp: new Date().toISOString(),
      },
    },
  ]);
  return true;
}

export async function searchDocumentVectors(input: DocumentSemanticSearchInput): Promise<DocumentSemanticSearchResult[]> {
  const vector = await generateEmbedding(input.query);
  if (!vector) return [];

  const must: Array<Record<string, unknown>> = [
    { key: "entityType", match: { value: ENTITY_TYPE } },
  ];
  if (input.organizationId) must.push({ key: "organizationId", match: { value: input.organizationId } });
  if (input.currentState) must.push({ key: "currentState", match: { value: input.currentState } });
  if (input.documentKind) must.push({ key: "documentKind", match: { value: input.documentKind } });
  for (const tag of input.tags ?? []) {
    must.push({ key: "tags", match: { value: tag } });
  }

  const raw = await searchSimilar(
    QDRANT_COLLECTIONS.DOCUMENTS,
    vector,
    { must },
    input.limit ?? 10,
    input.scoreThreshold ?? 0.55,
  );

  return raw.map((result) => ({
    id: String(result.payload["entityId"] ?? ""),
    documentId: String(result.payload["documentId"] ?? ""),
    title: String(result.payload["title"] ?? ""),
    contentPreview: String(result.payload["contentPreview"] ?? ""),
    score: result.score,
  }));
}
