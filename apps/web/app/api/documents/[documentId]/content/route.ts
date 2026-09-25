// GET /api/documents/:documentId/content — a managed document's stored file
// (BI-9D43CBEF). `?rendition=pdf` serves the PDF rendition inline ("View PDF");
// the default serves the original as a download ("Download original").
// `?version=N` pins a version; the default is the current one.
//
// Access matches the document page it serves: a signed-in session.
// @exposure authenticated

import { auth } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api/error";
import { resolveDocumentContent } from "@/lib/documents/document-content";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return apiErrorResponse("UNAUTHORIZED", "Sign in to open this document.", 401);

  const { documentId } = await context.params;
  const params = new URL(request.url).searchParams;
  const versionParam = params.get("version");
  const version = versionParam && /^\d+$/.test(versionParam) ? Number(versionParam) : null;
  const result = await resolveDocumentContent({
    documentId: decodeURIComponent(documentId),
    rendition: params.get("rendition") === "pdf" ? "pdf" : "original",
    version,
  });
  if (!result.ok) {
    return apiErrorResponse(result.status === 404 ? "NOT_FOUND" : "GONE", result.error, result.status);
  }

  return new Response(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": result.mimeType,
      "Content-Length": String(result.bytes.byteLength),
      "Content-Disposition": result.disposition,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
