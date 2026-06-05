// Onboarding business-document capture (BI-C97C0873, EP-CORPUS-BOOTSTRAP).
//
// Stores a business plan / key document the operator uploads during onboarding
// in the Document DMS (org-scoped, documentKind="plan"), extracting its text so
// it can later be indexed into the org WWWD corpus.
//
// Indexing into the corpus is the SECOND half of this BI and depends on the
// enrichment pipeline (BI-7C9D6198, `enrichOrgCorpus`). That call is wired
// through the optional `enrich` seam below: until the pipeline merges, the
// route passes no enricher and the document is simply captured in the DMS;
// once it lands, the route passes an enricher that calls enrichOrgCorpus with
// origin="document", trust="derived" — which, per the founder's draft-by-default
// decision, lands the derived material as a draft for review.

import {
  saveManagedDocument,
  type SaveManagedDocumentInput,
  type ManagedDocument,
} from "@/lib/documents/document-store";
import {
  parseFileContent,
  capParsedContentSize,
  type ParsedFileContent,
} from "@/lib/shared/file-parsers";

/** DMS documentKind for an onboarding-captured business document. */
export const BUSINESS_DOCUMENT_KIND = "plan";
/** Tags applied so these are findable as onboarding business docs. */
export const BUSINESS_DOCUMENT_TAGS = ["onboarding", "business-document"];

/** Deferred seam to the enrichment pipeline (BI-7C9D6198). */
export type DocumentEnricher = (args: {
  organizationId: string;
  documentId: string;
  title: string;
  text: string;
}) => Promise<void>;

export type CaptureBusinessDocumentInput = {
  organizationId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  /** Optional human title; falls back to the file name stem. */
  title?: string | null;
  actorPrincipalId?: string | null;
};

/** Injectable dependencies (real defaults; fakes in tests). */
export type CaptureBusinessDocumentDeps = {
  parse?: (buffer: Buffer, mimeType: string, fileName: string) => Promise<ParsedFileContent | null>;
  save?: (input: SaveManagedDocumentInput) => Promise<ManagedDocument>;
  /** When provided (post BI-7C9D6198), index the captured text into the corpus. */
  enrich?: DocumentEnricher;
};

export type CaptureBusinessDocumentResult = {
  documentId: string;
  title: string;
  summary: string | null;
  textLength: number;
  /** True when the enrichment seam was invoked (pipeline wired + text present). */
  enrichmentQueued: boolean;
};

function deriveTitleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return base.length > 0 ? base : "Business document";
}

export async function captureBusinessDocument(
  input: CaptureBusinessDocumentInput,
  deps: CaptureBusinessDocumentDeps = {},
): Promise<CaptureBusinessDocumentResult> {
  const parse = deps.parse ?? parseFileContent;
  const save = deps.save ?? saveManagedDocument;

  const parsed = await parse(input.buffer, input.mimeType, input.fileName);
  if (!parsed) {
    throw new Error(
      `Unsupported document type: ${input.fileName} (${input.mimeType || "unknown"}). ` +
        `Upload a PDF, Word doc, or text/markdown file.`,
    );
  }

  const capped = capParsedContentSize(parsed);
  const text = (capped.fullText ?? "").trim();
  const title = (input.title ?? "").trim() || deriveTitleFromFileName(input.fileName);

  const doc = await save({
    organizationId: input.organizationId,
    title,
    documentKind: BUSINESS_DOCUMENT_KIND,
    contentFormat: input.mimeType || "application/octet-stream",
    contentText: text.length > 0 ? text : null,
    summary: capped.summary ?? null,
    tags: BUSINESS_DOCUMENT_TAGS,
    sourceKind: "managed",
    actorPrincipalId: input.actorPrincipalId ?? null,
  });

  let enrichmentQueued = false;
  if (deps.enrich && text.length > 0) {
    await deps.enrich({
      organizationId: input.organizationId,
      documentId: doc.documentId,
      title,
      text,
    });
    enrichmentQueued = true;
  }

  return {
    documentId: doc.documentId,
    title,
    summary: capped.summary ?? null,
    textLength: text.length,
    enrichmentQueued,
  };
}
