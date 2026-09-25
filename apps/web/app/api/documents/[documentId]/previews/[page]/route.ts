// GET /api/documents/:documentId/previews/:page — one page preview image of a
// managed document (BI-543819B1): the slide thumbnails on the document page.
// `?version=N` pins a version; the default is the current one.
//
// Access matches the document page it serves: a signed-in session.
// @exposure authenticated

import { auth } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api/error";
import { resolvePreviewImage } from "@/lib/documents/document-previews";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string; page: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return apiErrorResponse("UNAUTHORIZED", "Sign in to open this document.", 401);

  const { documentId, page } = await context.params;
  if (!/^\d{1,3}$/.test(page) || Number(page) < 1) {
    return apiErrorResponse("NOT_FOUND", "No such preview page.", 404);
  }
  const versionParam = new URL(request.url).searchParams.get("version");
  const version = versionParam && /^\d+$/.test(versionParam) ? Number(versionParam) : null;
  const result = await resolvePreviewImage({ documentId: decodeURIComponent(documentId), page: Number(page), version });
  if (!result.ok) {
    return apiErrorResponse(result.status === 404 ? "NOT_FOUND" : "GONE", result.error, result.status);
  }

  const { bytes, mimeType, disposition } = result.data;
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
