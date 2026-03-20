// POST /api/v1/finance/invoices/:id/send — send invoice via email with PDF attachment

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError, apiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { getInvoice, sendInvoice } from "@/lib/actions/finance";
import { generateInvoicePdf, getInvoicePdfFilename } from "@/lib/invoice-pdf";
import { sendEmail, composeInvoiceEmail } from "@/lib/email";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);
    const { id } = await params;
    const invoice = await getInvoice(id);
    if (!invoice) throw apiError("NOT_FOUND", "Invoice not found", 404);
    if (!invoice.contact?.email)
      throw apiError("VALIDATION_ERROR", "Invoice has no contact email", 422);

    const { payToken } = await sendInvoice(id);

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ||
      request.headers.get("origin") ||
      "http://localhost:3000";
    const payUrl = `${baseUrl}/s/pay/${payToken}`;

    const pdf = await generateInvoicePdf(invoice);
    const filename = getInvoicePdfFilename(invoice.invoiceRef, invoice.account.name);

    const email = composeInvoiceEmail({
      to: invoice.contact.email,
      invoiceRef: invoice.invoiceRef,
      accountName: invoice.account.name,
      totalAmount: Number(invoice.totalAmount).toLocaleString("en-GB", {
        minimumFractionDigits: 2,
      }),
      currency: invoice.currency,
      dueDate: new Date(invoice.dueDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      payUrl,
    });

    await sendEmail({
      ...email,
      attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
    });

    return apiSuccess({ sent: true, payToken, payUrl });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
