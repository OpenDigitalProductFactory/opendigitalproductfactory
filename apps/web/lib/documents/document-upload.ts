// Upload a file into the managed document store from the documents workspace
// (BI-957915CB, AC-DPF-4). The file becomes a DocumentBlob and a managed
// document version through the same saveManagedDocument every other writer
// uses, so its renditions, full-text and semantic index and previews follow
// with no upload-specific code. A collection, when named, must be one the
// uploader may read; the new document is filed in it with a "contains" edge.

import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { DOCUMENT_TEXT_INLINE_LIMIT_BYTES, storeDocumentBlob } from "./blob-storage";
import { normalizeMimeType, officeSourceExtension, textOnlySourceExtension } from "./conversion/formats";
import { ORGANIZATION_ACCESS_SCOPE, RESTRICTED_ACCESS_SCOPE, type DocumentViewer } from "./document-access";
import { fileIntoCollection, findReadableCollection } from "./document-collections";
import { saveManagedDocument } from "./document-store";

/** Largest file the documents page accepts, the same limit as a coworker's binary save. */
export const DOCUMENT_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

/** The kind an uploaded file is stored as. */
export const UPLOADED_DOCUMENT_KIND = "file";

const TEXT_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
};

const OFFICE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  pdf: "application/pdf",
};

/** The extensions the picker offers. */
export const DOCUMENT_UPLOAD_ACCEPT = [...Object.keys(OFFICE_MIME_BY_EXTENSION), ...Object.keys(TEXT_MIME_BY_EXTENSION)]
  .map((extension) => `.${extension}`)
  .join(",");

function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  return match ? match[1]!.toLowerCase() : "";
}

/**
 * The stored format of an upload: the browser's MIME type when the store
 * understands it, otherwise the one its extension names (browsers send no
 * type for .md and an empty or generic one for some office files).
 */
export function uploadContentFormat(fileName: string, mimeType: string | null | undefined): string | null {
  const declared = normalizeMimeType(mimeType ?? "");
  if (officeSourceExtension(declared) || textOnlySourceExtension(declared)) return declared;
  if (declared === "text/markdown" || declared === "text/plain") return declared;
  const extension = extensionOf(fileName);
  return OFFICE_MIME_BY_EXTENSION[extension] ?? TEXT_MIME_BY_EXTENSION[extension] ?? null;
}

function titleFromFileName(fileName: string): string {
  const stem = fileName.trim().replace(/\.[A-Za-z0-9]+$/, "").replace(/[_]+/g, " ").trim();
  return (stem || "Untitled file").slice(0, 200);
}

export type DocumentUploadInput = {
  fileName: string;
  mimeType: string | null;
  bytes: Buffer;
  title?: string | null;
  accessScope?: string | null;
  collectionId?: string | null;
  viewer: DocumentViewer;
  actorPrincipalId: string | null;
};

export type DocumentUploadResult = { documentId: string; version: number; route: string };

export async function uploadManagedDocument(input: DocumentUploadInput): Promise<ActionResult<DocumentUploadResult>> {
  if (input.bytes.byteLength === 0) return err("The file is empty.");
  if (input.bytes.byteLength > DOCUMENT_UPLOAD_LIMIT_BYTES) {
    return err(`The file is larger than ${DOCUMENT_UPLOAD_LIMIT_BYTES / (1024 * 1024)} MB.`);
  }
  const contentFormat = uploadContentFormat(input.fileName, input.mimeType);
  if (!contentFormat) {
    return err("This kind of file cannot be stored here. Upload a Word, Excel, PowerPoint, OpenDocument, RTF, PDF, text or markdown file.");
  }
  const collectionId = input.collectionId?.trim() || null;
  const collection = collectionId ? await findReadableCollection(collectionId, input.viewer) : null;
  if (collectionId && !collection) return err("That collection was not found.");
  // A named scope wins; otherwise a file dropped into a restricted collection
  // is restricted too, and anything else is visible to the organization.
  const requestedScope = input.accessScope === RESTRICTED_ACCESS_SCOPE || input.accessScope === ORGANIZATION_ACCESS_SCOPE ? input.accessScope : null;
  const accessScope = requestedScope ?? (collection && collection.accessScope !== ORGANIZATION_ACCESS_SCOPE ? RESTRICTED_ACCESS_SCOPE : ORGANIZATION_ACCESS_SCOPE);

  const isText = contentFormat === "text/markdown" || contentFormat === "text/plain";
  const inlineText = isText && input.bytes.byteLength <= DOCUMENT_TEXT_INLINE_LIMIT_BYTES ? input.bytes.toString("utf-8") : null;
  const blob = inlineText === null ? await storeDocumentBlob({ content: input.bytes, mimeType: contentFormat }) : null;

  const saved = await saveManagedDocument({
    title: input.title?.trim() || titleFromFileName(input.fileName),
    documentKind: UPLOADED_DOCUMENT_KIND,
    contentFormat,
    contentText: inlineText,
    contentBlobId: blob?.id ?? null,
    contentSha256: blob?.sha256 ?? null,
    summary: `Uploaded ${input.fileName.trim().slice(0, 200)}`,
    accessScope,
    ownerPrincipalId: input.actorPrincipalId,
    createdByPrincipalId: input.actorPrincipalId,
    actorPrincipalId: input.actorPrincipalId,
    viewer: input.viewer,
  });
  if (collectionId) {
    await fileIntoCollection({ collectionId, documentId: saved.documentId, viewer: input.viewer, actorPrincipalId: input.actorPrincipalId });
  }
  return ok({
    documentId: saved.documentId,
    version: saved.currentVersion?.version ?? 1,
    route: `/workspace/documents/${encodeURIComponent(saved.documentId)}`,
  });
}
