// Document renditions (BI-9D43CBEF, slice S4 of BI-815D40C6).
//
// An office file saved to the document store is a blob nothing can read: no
// full-text match, no embedding, no preview. This module derives two
// renditions of such a DocumentVersion through the dpf-doctools engine
// (convertDocument):
//   - pdf: stored as a DocumentBlob, served by the document page's "View PDF";
//   - plain_text: kept inline (up to the inline limit) and indexed for
//     full-text search (DocumentRendition."searchVector") and semantic search
//     (storeDocumentVector), so doc_search finds the body text.
//
// It runs as a durable background job (queue/functions/document-renditions.ts),
// requested from the version save in document-store.ts and swept by a bounded
// backfill when the converter becomes available. It is idempotent on
// (documentVersionId, renditionKind) through the table's unique key, and it
// never throws for an expected failure: a failure is recorded once per version
// as a DocumentLifecycleEvent with its typed reason, so an unconvertible file
// is visible rather than silently unindexed.

import { DocumentRenditionKind, prisma } from "@dpf/db";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { EMBEDDED_OBJECTS_REASON, odfEmbeddedObjects } from "@/lib/shared/odf-embedded-objects";
import { DOCUMENT_TEXT_INLINE_LIMIT_BYTES, readDocumentBlob, storeDocumentBlob } from "./blob-storage";
import { getConverterAvailability } from "./conversion/availability";
import { convertDocument, type ConversionFailureReason } from "./conversion/convert";
import { OFFICE_SOURCE_MIME_TYPES, officeSourceExtension, type ConverterTarget } from "./conversion/formats";
import { storeDocumentVector, type StoreDocumentVectorInput } from "./embeddings";

/** Rendition kinds in the order they are produced; the engine target for each. */
export const RENDITION_TARGETS: ReadonlyArray<readonly [DocumentRenditionKind, ConverterTarget]> = [
  [DocumentRenditionKind.pdf, "pdf"],
  [DocumentRenditionKind.plain_text, "txt"],
];

export const DEFAULT_BACKFILL_LIMIT = 25;
export const MAX_BACKFILL_LIMIT = 100;
const MAX_FAILURE_DETAIL_CHARS = 500;

/**
 * `embedded-objects`: the converter refused an OpenDocument file that embeds a
 * chart or other object; its hardened profile does not open them (BI-BFF142A1).
 */
export type RenditionFailureReason = ConversionFailureReason | "blob-unreadable" | "embedded-objects";

/** The OpenDocument sources (formats.ts extensions) whose manifest names embedded objects. */
const ODF_SOURCES: ReadonlySet<string> = new Set(["odt", "ods", "odp", "odg"]);

export type RenditionOutcome =
  | { status: "rendered"; kinds: DocumentRenditionKind[] }
  | { status: "skipped"; reason: "not-found" | "not-office" | "already-rendered" }
  | { status: "failed"; reason: RenditionFailureReason; kind: DocumentRenditionKind };

export type BackfillOutcome = {
  status: "swept" | "converter-unavailable";
  detail?: string;
  processed: number;
  results: Array<{ documentVersionId: string } & RenditionOutcome>;
};

type RenditionDb = typeof prisma;

export type RenditionDeps = {
  db: RenditionDb;
  convert: typeof convertDocument;
  readBlob: (blob: { storageKey: string; sha256: string }) => Promise<Buffer>;
  storeBlob: (bytes: Buffer, mimeType: string) => Promise<{ id: string }>;
  indexVector: (input: StoreDocumentVectorInput) => Promise<boolean>;
  availability: () => Promise<{ available: boolean; detail: string }>;
  now: () => Date;
  inlineTextLimitBytes?: number;
};

function defaultDeps(): RenditionDeps {
  return {
    db: prisma,
    convert: convertDocument,
    readBlob: (blob) => readDocumentBlob({ storageKey: blob.storageKey, expectedSha256: blob.sha256 }),
    storeBlob: (bytes, mimeType) => storeDocumentBlob({ content: bytes, mimeType }),
    indexVector: storeDocumentVector,
    availability: getConverterAvailability,
    now: () => new Date(),
  };
}

export { needsRenditions } from "./rendition-rules";

/** Cut text to at most `limitBytes` of UTF-8 without splitting a character. */
function truncateUtf8(text: string, limitBytes: number): string {
  const bytes = Buffer.from(text, "utf-8");
  if (bytes.byteLength <= limitBytes) return text;
  return bytes.subarray(0, limitBytes).toString("utf-8").replace(/�+$/, "");
}

async function loadVersion(db: RenditionDb, documentVersionId: string) {
  return db.documentVersion.findUnique({
    where: { id: documentVersionId },
    select: {
      id: true,
      version: true,
      contentFormat: true,
      summary: true,
      contentBlob: { select: { id: true, storageKey: true, sha256: true } },
      renditions: { select: { renditionKind: true } },
      document: {
        select: {
          id: true,
          documentId: true,
          organizationId: true,
          title: true,
          documentKind: true,
          currentState: true,
          ownerPrincipalId: true,
          currentVersionId: true,
          tags: { select: { tag: true } },
        },
      },
    },
  });
}

type LoadedVersion = NonNullable<Awaited<ReturnType<typeof loadVersion>>>;

/**
 * Record a failure once per (reason, kind, version). A converter that stays
 * off must not write an event on every retry or backfill pass.
 */
async function recordFailure(
  deps: RenditionDeps,
  version: LoadedVersion,
  kind: DocumentRenditionKind,
  reason: RenditionFailureReason,
  detail: string,
): Promise<void> {
  const key = `rendition ${reason}: ${kind} of v${version.version}.`;
  try {
    const existing = await deps.db.documentLifecycleEvent.findFirst({
      where: { documentId: version.document.id, reason: { startsWith: key } },
      select: { id: true },
    });
    if (existing) return;
    await deps.db.documentLifecycleEvent.create({
      data: {
        documentId: version.document.id,
        fromState: version.document.currentState,
        toState: version.document.currentState,
        reason: `${key} ${detail.slice(0, MAX_FAILURE_DETAIL_CHARS)}`,
      },
    });
  } catch (err) {
    console.warn("[renditions] could not record the rendition failure:", getErrorMessage(err));
  }
}

async function upsertRendition(
  deps: RenditionDeps,
  documentVersionId: string,
  renditionKind: DocumentRenditionKind,
  fields: { contentText: string | null; blobId: string | null; mimeType: string },
): Promise<void> {
  await deps.db.documentRendition.upsert({
    where: { documentVersionId_renditionKind: { documentVersionId, renditionKind } },
    create: { documentVersionId, renditionKind, ...fields },
    update: fields,
    select: { id: true },
  });
}

/** Index the text rendition of the CURRENT version; a superseded one stays unindexed. */
async function indexText(deps: RenditionDeps, version: LoadedVersion, text: string): Promise<void> {
  const document = version.document;
  if (document.currentVersionId !== version.id) return;
  const vectorStored = await deps.indexVector({
    id: document.id,
    documentId: document.documentId,
    documentVersionId: version.id,
    organizationId: document.organizationId,
    title: document.title,
    documentKind: document.documentKind,
    contentFormat: version.contentFormat,
    currentState: document.currentState,
    ownerPrincipalId: document.ownerPrincipalId,
    tags: document.tags.map((tag) => tag.tag),
    contentText: text,
    summary: version.summary,
  }).catch(() => false);
  const now = deps.now();
  await deps.db.document.update({
    where: { id: document.id },
    data: vectorStored ? { fullTextIndexedAt: now, semanticIndexedAt: now } : { fullTextIndexedAt: now },
    select: { id: true },
  }).catch(() => null);
}

export async function generateDocumentRenditions(
  documentVersionId: string,
  overrides: Partial<RenditionDeps> = {},
): Promise<RenditionOutcome> {
  const deps: RenditionDeps = { ...defaultDeps(), ...overrides };
  const version = await loadVersion(deps.db, documentVersionId);
  if (!version) return { status: "skipped", reason: "not-found" };
  const from = officeSourceExtension(version.contentFormat);
  if (!from || !version.contentBlob) return { status: "skipped", reason: "not-office" };

  const existing = new Set(version.renditions.map((rendition) => rendition.renditionKind));
  const missing = RENDITION_TARGETS.filter(([kind]) => !existing.has(kind));
  if (missing.length === 0) return { status: "skipped", reason: "already-rendered" };

  let original: Buffer;
  try {
    original = await deps.readBlob(version.contentBlob);
  } catch (err) {
    await recordFailure(deps, version, missing[0]![0], "blob-unreadable", getErrorMessage(err));
    return { status: "failed", reason: "blob-unreadable", kind: missing[0]![0] };
  }

  const inlineLimit = deps.inlineTextLimitBytes ?? DOCUMENT_TEXT_INLINE_LIMIT_BYTES;
  const rendered: DocumentRenditionKind[] = [];
  for (const [kind, to] of missing) {
    const result = await deps.convert({ input: original, from, to });
    if (!result.ok) {
      const objects = result.reason === "conversion-failed" && ODF_SOURCES.has(from) ? odfEmbeddedObjects(original) ?? [] : [];
      if (objects.length > 0) {
        const detail = `${EMBEDDED_OBJECTS_REASON} Embedded: ${objects.slice(0, 5).join(", ")}. ${result.error}`;
        await recordFailure(deps, version, kind, "embedded-objects", detail);
        return { status: "failed", reason: "embedded-objects", kind };
      }
      await recordFailure(deps, version, kind, result.reason, result.error);
      return { status: "failed", reason: result.reason, kind };
    }
    const { bytes, mime } = result.data;
    if (kind === DocumentRenditionKind.pdf) {
      const blob = await deps.storeBlob(bytes, mime);
      await upsertRendition(deps, version.id, kind, { contentText: null, blobId: blob.id, mimeType: mime });
    } else {
      const text = bytes.toString("utf-8");
      const inline = truncateUtf8(text, inlineLimit);
      // Text past the inline limit keeps its full bytes as a blob; the inline
      // head is what full-text and semantic search see.
      const blobId = inline.length < text.length ? (await deps.storeBlob(bytes, mime)).id : null;
      await upsertRendition(deps, version.id, kind, { contentText: inline, blobId, mimeType: mime });
      await indexText(deps, version, inline);
    }
    rendered.push(kind);
  }
  return { status: "rendered", kinds: rendered };
}

/**
 * The bounded one-shot sweep: current office versions that lack a rendition,
 * newest first, at most `limit` (capped at 100) per pass. Run when the
 * converter becomes available (rendition-trigger.ts); while it is unavailable
 * the sweep does nothing and records nothing.
 */
export async function backfillDocumentRenditions(
  input: { limit?: number } = {},
  overrides: Partial<RenditionDeps> = {},
): Promise<BackfillOutcome> {
  const deps: RenditionDeps = { ...defaultDeps(), ...overrides };
  const availability = await deps.availability();
  if (!availability.available) {
    return { status: "converter-unavailable", detail: availability.detail, processed: 0, results: [] };
  }
  const requested = Number.isFinite(input.limit) ? Math.trunc(input.limit!) : DEFAULT_BACKFILL_LIMIT;
  const take = Math.min(Math.max(requested, 1), MAX_BACKFILL_LIMIT);
  const pending = await deps.db.documentVersion.findMany({
    where: {
      contentBlobId: { not: null },
      contentFormat: { in: [...OFFICE_SOURCE_MIME_TYPES] },
      currentForDocuments: { some: {} },
      OR: RENDITION_TARGETS.map(([renditionKind]) => ({ renditions: { none: { renditionKind } } })),
    },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true },
  });

  const results: BackfillOutcome["results"] = [];
  for (const { id } of pending) {
    results.push({ documentVersionId: id, ...(await generateDocumentRenditions(id, deps)) });
  }
  return { status: "swept", processed: results.length, results };
}
