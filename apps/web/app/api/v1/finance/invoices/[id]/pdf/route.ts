// GET /api/v1/finance/invoices/:id/pdf — download invoice PDF

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { getInvoice } from "@/lib/actions/finance";
import { generateInvoicePdf, getInvoicePdfFilename } from "@/lib/invoice-pdf";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);
    const { id } = await params;
    const invoice = await getInvoice(id);
    if (!invoice) throw apiError("NOT_FOUND", "Invoice not found", 404);

    const pdfBuffer = await generateInvoicePdf(invoice);
    const filename = getInvoicePdfFilename(invoice.invoiceRef, invoice.account.name);

    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
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
