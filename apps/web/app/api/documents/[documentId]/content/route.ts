// GET /api/documents/:documentId/content — a managed document's stored file
// (BI-9D43CBEF). `?rendition=pdf` serves the PDF rendition inline ("View PDF");
// the default serves the original as a download ("Download original").
// `?version=N` pins a version; the default is the current one.
// `?export=docx|odt|pdf` exports the version through the document engine
// (BI-4865EB4D) and serves it as a download; the export is stored as a
// rendition, so asking again serves the stored file.
//
// Access matches the document page it serves: a signed-in session.
// @exposure authenticated

import { auth } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api/error";
import { resolveDocumentContent } from "@/lib/documents/document-content";
import {
  documentExportFailureMessage,
  exportDocumentVersion,
  isDocumentExportFormat,
  type DocumentExportFailureReason,
} from "@/lib/documents/document-office-export";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return apiErrorResponse("UNAUTHORIZED", "Sign in to open this document.", 401);

  const { documentId } = await context.params;
  const params = new URL(request.url).searchParams;
  const versionParam = params.get("version");
  const version = versionParam && /^\d+$/.test(versionParam) ? Number(versionParam) : null;
  const exportFormat = params.get("export");
  if (exportFormat !== null) {
    if (!isDocumentExportFormat(exportFormat)) {
      return apiErrorResponse("BAD_REQUEST", "Export to docx, odt or pdf.", 400);
    }
    const exported = await exportDocumentVersion({ documentId: decodeURIComponent(documentId), version, format: exportFormat });
    if (!exported.ok) {
      const { code, status } = EXPORT_FAILURE_STATUS[exported.reason];
      return apiErrorResponse(code, documentExportFailureMessage(exported.reason), status);
    }
    const { bytes, mimeType, filename } = exported.data;
    return fileResponse(bytes, mimeType, `attachment; filename="${filename}"`);
  }
  const result = await resolveDocumentContent({
    documentId: decodeURIComponent(documentId),
    rendition: params.get("rendition") === "pdf" ? "pdf" : "original",
    version,
  });
  if (!result.ok) {
    return apiErrorResponse(result.status === 404 ? "NOT_FOUND" : "GONE", result.error, result.status);
  }

  const { bytes, mimeType, disposition } = result.data;
  return fileResponse(bytes, mimeType, disposition);
}

const EXPORT_FAILURE_STATUS: Readonly<Record<DocumentExportFailureReason, { code: string; status: number }>> = {
  "not-found": { code: "NOT_FOUND", status: 404 },
  "no-content": { code: "NOT_FOUND", status: 404 },
  "not-exportable": { code: "UNPROCESSABLE", status: 422 },
  "blob-unreadable": { code: "GONE", status: 410 },
  "input-too-large": { code: "PAYLOAD_TOO_LARGE", status: 413 },
  "converter-unavailable": { code: "SERVICE_UNAVAILABLE", status: 503 },
  timeout: { code: "TIMEOUT", status: 504 },
  "conversion-failed": { code: "UNPROCESSABLE", status: 422 },
};

function fileResponse(bytes: Buffer, mimeType: string, disposition: string): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": disposition,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
