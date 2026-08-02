// GET /api/v1/finance/invoices/:id/documents/:documentId — download ONE stored
// revision, byte-for-byte as it was sent. Distinct from .../pdf, which re-renders
// from current invoice data and will differ from this after any edit.

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { getInvoiceDocumentBlobRef } from "@/lib/finance/invoice-document-store";
import { getDocumentBlobStorageRoot } from "@/lib/documents/blob-storage";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id, documentId } = await params;

    const ref = await getInvoiceDocumentBlobRef(documentId);
    if (!ref) throw apiError("NOT_FOUND", "Invoice document not found", 404);

    // The snapshot must belong to the invoice in the path: without this, a caller
    // could read any snapshot by guessing an id under an invoice they can see.
    const { prisma } = await import("@dpf/db");
    const owner = await prisma.invoiceDocument.findUnique({
      where: { id: documentId },
      select: { invoiceId: true },
    });
    if (!owner || owner.invoiceId !== id) {
      throw apiError("NOT_FOUND", "Invoice document not found", 404);
    }

    const { join } = await import("node:path");
    const { readFile } = await import("node:fs/promises");
    const root = await getDocumentBlobStorageRoot();

    let bytes: Buffer;
    try {
      bytes = await readFile(join(root, ref.storageKey));
    } catch {
      // The row exists but the blob is gone — say so plainly rather than 500ing,
      // because it means the retention story has failed and that is worth naming.
      throw apiError(
        "BLOB_MISSING",
        `The stored copy of ${ref.invoiceRef} is recorded but its content is missing from document storage.`,
        410,
      );
    }

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": ref.mimeType,
        "Content-Disposition": `attachment; filename="${ref.filename}"`,
        "Content-Length": String(bytes.byteLength),
        // Immutable by construction: this revision's bytes never change.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
