// POST /api/v1/finance/invoices/:id/send — send invoice via email with PDF attachment

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { getInvoice, sendInvoice } from "@/lib/actions/finance";
import { getOrgIdentity } from "@/lib/org-identity";
import { generateInvoicePdf, getInvoicePdfFilename } from "@/lib/invoice-pdf";
import { sendEmail, composeInvoiceEmail, isEmailConfigured } from "@/lib/email";
import { checkInvoiceTransition, type InvoiceStatus } from "@/lib/finance/invoice-lifecycle";
import { snapshotInvoiceDocument } from "@/lib/finance/invoice-document-store";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    // Pre-flight: refuse to "send" when email delivery isn't configured, instead
    // of marking the invoice sent and silently dropping the email (the cold-start
    // fresh-install failure from the Runs 6 & 7 audit). Checked before any state
    // mutation so a failed send never leaves the invoice falsely marked "sent".
    if (!(await isEmailConfigured())) {
      throw apiError(
        "EMAIL_NOT_CONFIGURED",
        "Email delivery is not configured, so this invoice can't be emailed. Set it up in Admin → Settings → Email (or via SMTP environment variables), then try again.",
        422,
      );
    }

    const { id } = await params;
    const invoice = await getInvoice(id);
    if (!invoice) throw apiError("NOT_FOUND", "Invoice not found", 404);
    if (!invoice.contact?.email)
      throw apiError("VALIDATION_ERROR", "Invoice has no contact email", 422);

    // Checked here as well as inside sendInvoice so the operator gets the actual
    // reason: a bare throw out of the action surfaces as a generic 500.
    const transition = checkInvoiceTransition(invoice.status as InvoiceStatus, "sent");
    if (!transition.allowed) {
      throw apiError("ILLEGAL_TRANSITION", transition.reason, 422);
    }

    const { payToken } = await sendInvoice(id);

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ||
      request.headers.get("origin") ||
      "http://localhost:3000";
    const payUrl = `${baseUrl}/s/pay/${payToken}`;

    const issuer = await getOrgIdentity();
    const pdf = await generateInvoicePdf({ ...invoice, issuer });
    const filename = getInvoicePdfFilename(invoice.invoiceRef, invoice.account.name);

    const email = composeInvoiceEmail({
      to: invoice.contact.email,
      invoiceRef: invoice.invoiceRef,
      accountName: invoice.account.name,
      orgName: issuer?.name ?? null,
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
      from: issuer?.email ? `${issuer.name} <${issuer.email}>` : undefined,
      attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
    });

    // Snapshot AFTER the send succeeds: these exact bytes are now the document the
    // customer holds, so this is the moment it becomes worth preserving. Recording
    // it before a failed send would claim a delivery that never happened.
    //
    // Best-effort, deliberately: a storage hiccup must not turn a delivered invoice
    // into a 500 the operator will retry, re-sending the customer a second copy.
    // The failure is loud in the logs and the missing revision is visible on the
    // invoice, which is the right place to notice it.
    let revision: number | null = null;
    try {
      const snapshot = await snapshotInvoiceDocument({
        invoiceId: invoice.id,
        invoiceRef: invoice.invoiceRef,
        accountName: invoice.account.name,
        pdf,
        role: "sent-copy",
        sentToEmail: invoice.contact.email,
      });
      revision = snapshot.revision;
    } catch (err) {
      // The invoice id is a route parameter (tainted) and is intentionally not
      // logged; invoiceRef carries the debugging signal instead.
      console.error(
        `[invoice-document] failed to persist the sent copy of ${invoice.invoiceRef}:`,
        err,
      );
    }

    return apiSuccess({ sent: true, payToken, payUrl, revision });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
