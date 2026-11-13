// POST /api/documents — upload a file from the documents workspace into the
// managed document store (BI-957915CB). Multipart form data: `file`, optional
// `title`, `accessScope` ("organization" or "restricted") and `collectionId`.
// The uploader owns the new document; its renditions, search and previews
// follow from the store's own save path.
//
// Access matches the documents page: a signed-in session. A named collection
// must be one the uploader may read.
// @exposure authenticated

import { auth } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api/error";
import { resolveDocumentViewer } from "@/lib/documents/document-access";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";
import { DOCUMENT_UPLOAD_LIMIT_BYTES, uploadManagedDocument } from "@/lib/documents/document-upload";

export const runtime = "nodejs";

function field(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return apiErrorResponse("UNAUTHORIZED", "Sign in to upload a document.", 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiErrorResponse("BAD_REQUEST", "Send the file as multipart form data.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return apiErrorResponse("BAD_REQUEST", "Choose a file to upload.", 400);
  if (file.size > DOCUMENT_UPLOAD_LIMIT_BYTES) {
    return apiErrorResponse("PAYLOAD_TOO_LARGE", `The file is larger than ${DOCUMENT_UPLOAD_LIMIT_BYTES / (1024 * 1024)} MB.`, 413);
  }

  // The uploader owns the document, so they need a principal; the page's
  // state actions resolve one the same way.
  const principal = await syncUserPrincipal(session.user.id).catch(() => null);
  const viewer = principal ? { principalId: principal.id } : await resolveDocumentViewer(session.user.id);
  const result = await uploadManagedDocument({
    fileName: file.name,
    mimeType: file.type || null,
    bytes: Buffer.from(await file.arrayBuffer()),
    title: field(form, "title"),
    accessScope: field(form, "accessScope"),
    collectionId: field(form, "collectionId"),
    viewer,
    actorPrincipalId: viewer.principalId,
  });
  if (!result.ok) return apiErrorResponse("UNPROCESSABLE", result.error, 422);
  return Response.json(result.data, { status: 201 });
}
