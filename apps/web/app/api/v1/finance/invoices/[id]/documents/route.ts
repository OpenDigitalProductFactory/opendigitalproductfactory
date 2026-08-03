// GET /api/v1/finance/invoices/:id/documents — the persisted document revisions
// for an invoice. These are immutable snapshots of what was actually sent, which
// is NOT the same thing as re-rendering the invoice from current data.

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { getInvoice } from "@/lib/actions/finance";
import { listInvoiceDocuments } from "@/lib/finance/invoice-document-store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id } = await params;

    const invoice = await getInvoice(id);
    if (!invoice) throw apiError("NOT_FOUND", "Invoice not found", 404);

    const documents = await listInvoiceDocuments(id);

    return apiSuccess({ invoiceRef: invoice.invoiceRef, documents });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
