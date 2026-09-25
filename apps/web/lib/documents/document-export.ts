// Document export (BI-4865EB4D, slice S5 of BI-815D40C6).
//
// A managed document version exports to .docx, .odt or .pdf through the
// dpf-doctools engine (convertDocument):
//   - a markdown version goes markdown -> HTML (markdown-html.ts, the page's own
//     renderer) -> the engine; plain text and HTML take the same HTML path;
//   - a stored word-processing file (.doc, .docx, .odt, .rtf) converts from its
//     own format; any office file can export to PDF.
// The result is stored as a DocumentRendition of the version (kind docx, odt or
// pdf, blob-backed), so a second export of the same version is served from the
// store without starting the engine again. A version's content never changes,
// so the stored rendition stays valid for that version.
//
// Expected failures come back as a typed result and never throw: the engine's
// own reasons (converter-unavailable, timeout, ...) pass through unchanged.

import { DocumentRenditionKind, prisma } from "@dpf/db";
import { err, ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { readDocumentBlob, storeDocumentBlob } from "./blob-storage";
import { convertDocument, type ConversionFailureReason } from "./conversion/convert";
import { CONVERTER_TARGET_MIME, normalizeMimeType, officeSourceExtension } from "./conversion/formats";
import { contentFilename } from "./document-content";
import { markdownToHtmlDocument, plainTextToHtmlDocument } from "./markdown-html";

export const DOCUMENT_EXPORT_FORMATS = ["docx", "odt", "pdf"] as const;
export type DocumentExportFormat = (typeof DOCUMENT_EXPORT_FORMATS)[number];

export const DOCUMENT_EXPORT_LABELS: Readonly<Record<DocumentExportFormat, string>> = {
  docx: "Word (.docx)",
  odt: "OpenDocument (.odt)",
  pdf: "PDF (.pdf)",
};

export function isDocumentExportFormat(value: unknown): value is DocumentExportFormat {
  return typeof value === "string" && (DOCUMENT_EXPORT_FORMATS as readonly string[]).includes(value);
}

const KIND_BY_FORMAT: Readonly<Record<DocumentExportFormat, DocumentRenditionKind>> = {
  docx: DocumentRenditionKind.docx,
  odt: DocumentRenditionKind.odt,
  pdf: DocumentRenditionKind.pdf,
};

/** Stored office formats that are word-processing documents, so .docx/.odt make sense. */
const WORD_PROCESSING_SOURCES: ReadonlySet<string> = new Set(["doc", "docx", "docm", "odt", "rtf"]);

/** Text formats rendered to HTML before conversion. */
const TEXT_SOURCES: ReadonlySet<string> = new Set(["text/markdown", "text/x-markdown", "text/plain", "text/html"]);

/** The formats a version with this content format can export to (none: no export control). */
export function exportableFormats(contentFormat: string): DocumentExportFormat[] {
  const office = officeSourceExtension(contentFormat);
  if (office) return WORD_PROCESSING_SOURCES.has(office) ? [...DOCUMENT_EXPORT_FORMATS] : ["pdf"];
  return TEXT_SOURCES.has(normalizeMimeType(contentFormat)) ? [...DOCUMENT_EXPORT_FORMATS] : [];
}

export type DocumentExportFailureReason =
  | ConversionFailureReason
  | "not-found"
  | "no-content"
  | "not-exportable"
  | "blob-unreadable";

export type DocumentExport = {
  format: DocumentExportFormat;
  version: number;
  bytes: Buffer;
  mimeType: string;
  filename: string;
  blobId: string | null;
  /** True when a stored rendition was served and the engine did not run. */
  reused: boolean;
};

export type DocumentExportFailure = ActionFailure & { reason: DocumentExportFailureReason };
export type DocumentExportResult = ActionSuccess<DocumentExport> | DocumentExportFailure;

type BlobRef = { storageKey: string; sha256: string };

export type DocumentExportDeps = {
  db: Pick<typeof prisma, "document" | "documentRendition">;
  convert: typeof convertDocument;
  readBlob: (blob: BlobRef) => Promise<Buffer>;
  storeBlob: (bytes: Buffer, mimeType: string) => Promise<{ id: string }>;
};

function defaultDeps(): DocumentExportDeps {
  return {
    db: prisma,
    convert: convertDocument,
    readBlob: (blob) => readDocumentBlob({ storageKey: blob.storageKey, expectedSha256: blob.sha256 }),
    storeBlob: (bytes, mimeType) => storeDocumentBlob({ content: bytes, mimeType }),
  };
}

const fail = (reason: DocumentExportFailureReason, error: string): DocumentExportFailure => ({ ...err(error), reason });

type VersionRow = {
  id: string;
  version: number;
  contentFormat: string;
  contentText: string | null;
  contentBlob: BlobRef | null;
  renditions: Array<{ renditionKind: string; mimeType: string | null; blob: BlobRef | null }>;
};

function versionSelect(kind: DocumentRenditionKind) {
  return {
    id: true,
    version: true,
    contentFormat: true,
    contentText: true,
    contentBlob: { select: { storageKey: true, sha256: true } },
    renditions: {
      where: { renditionKind: kind },
      select: { renditionKind: true, mimeType: true, blob: { select: { storageKey: true, sha256: true } } },
    },
  };
}

type Source = { input: Buffer; from: string };

/** What the engine reads for this version, or why it cannot export to `format`. */
async function exportSource(
  deps: DocumentExportDeps,
  version: VersionRow,
  format: DocumentExportFormat,
  title: string,
): Promise<ActionSuccess<Source> | DocumentExportFailure> {
  const office = officeSourceExtension(version.contentFormat);
  const mime = normalizeMimeType(version.contentFormat);
  if (!exportableFormats(version.contentFormat).includes(format)) {
    return fail("not-exportable", `A ${office ?? mime} document cannot be exported to ${format}.`);
  }
  if (office && !version.contentBlob) return fail("no-content", "This version has no stored file to export.");

  let stored: Buffer | null = null;
  if (version.contentBlob) {
    try {
      stored = await deps.readBlob(version.contentBlob);
    } catch (error) {
      return fail("blob-unreadable", `The stored file could not be read: ${getErrorMessage(error)}`);
    }
  }
  if (office) return ok({ input: stored!, from: office });

  const text = stored ? stored.toString("utf-8") : version.contentText ?? "";
  if (text.trim().length === 0) return fail("no-content", "This version has no content to export.");
  const html =
    mime === "text/html" ? text
    : mime === "text/plain" ? plainTextToHtmlDocument(text, title)
    : markdownToHtmlDocument(text, title);
  return ok({ input: Buffer.from(html, "utf-8"), from: "html" });
}

/**
 * Export one version (the current one by default) of a managed document.
 * Serves the stored rendition when there is one; otherwise converts, stores
 * the result as a rendition and returns it.
 */
export async function exportDocumentVersion(
  input: { documentId: string; version?: number | null; format: DocumentExportFormat },
  overrides: Partial<DocumentExportDeps> = {},
): Promise<DocumentExportResult> {
  const deps: DocumentExportDeps = { ...defaultDeps(), ...overrides };
  const kind = KIND_BY_FORMAT[input.format];
  const pinned = typeof input.version === "number" && Number.isInteger(input.version);
  const select = versionSelect(kind);
  const document = (await deps.db.document.findUnique({
    where: { documentId: input.documentId },
    select: pinned
      ? { title: true, versions: { where: { version: input.version! }, take: 1, select } }
      : { title: true, currentVersion: { select } },
  })) as { title: string; currentVersion?: VersionRow | null; versions?: VersionRow[] } | null;
  if (!document) return fail("not-found", "Document not found.");
  const version = pinned
    ? document.versions?.find((candidate) => candidate.version === input.version)
    : document.currentVersion;
  if (!version) return fail("not-found", "Document version not found.");

  const filename = contentFilename(document.title, input.format);
  const stored = version.renditions.find((rendition) => rendition.renditionKind === kind && rendition.blob);
  if (stored?.blob) {
    try {
      const bytes = await deps.readBlob(stored.blob);
      const mimeType = stored.mimeType ?? CONVERTER_TARGET_MIME[input.format];
      return ok({ format: input.format, version: version.version, bytes, mimeType, filename, blobId: null, reused: true });
    } catch {
      // An unreadable stored rendition is regenerated below.
    }
  }

  const source = await exportSource(deps, version, input.format, document.title);
  if (!source.ok) return source;
  const converted = await deps.convert({ input: source.data.input, from: source.data.from, to: input.format });
  if (!converted.ok) return fail(converted.reason, converted.error);

  const { bytes, mime } = converted.data;
  const blob = await deps.storeBlob(bytes, mime);
  const fields = { contentText: null, blobId: blob.id, mimeType: mime };
  await deps.db.documentRendition.upsert({
    where: { documentVersionId_renditionKind: { documentVersionId: version.id, renditionKind: kind } },
    create: { documentVersionId: version.id, renditionKind: kind, ...fields },
    update: fields,
    select: { id: true },
  });
  return ok({ format: input.format, version: version.version, bytes, mimeType: mime, filename, blobId: blob.id, reused: false });
}

/** Plain-language copy for an export failure, for the page and the API. */
export function documentExportFailureMessage(reason: DocumentExportFailureReason): string {
  switch (reason) {
    case "converter-unavailable":
      return "Export needs document conversion, which is not available on this install.";
    case "timeout":
      return "Exporting this document took too long. Try again, or export a smaller version.";
    case "input-too-large":
      return "This document is too large to export.";
    case "not-found":
      return "Document not found.";
    case "no-content":
      return "This version has no content to export.";
    case "not-exportable":
      return "This version cannot be exported to that format.";
    case "blob-unreadable":
      return "The stored file could not be read, so it could not be exported.";
    default:
      return "This document could not be exported.";
  }
}
