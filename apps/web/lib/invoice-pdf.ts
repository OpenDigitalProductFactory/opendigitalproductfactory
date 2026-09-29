// Invoice PDF: the invoice HTML (lib/finance/invoice-html.ts) printed to PDF by
// the dpf-doctools engine, through the portal's one conversion entry point
// (convertDocument, `--from html --to pdf`). Plan 2026-09-08 M5 retired
// @react-pdf/renderer, which this module used to render with.
//
// The public contract is unchanged: generateInvoicePdf() resolves to the PDF
// bytes as a Buffer and rejects when no PDF could be produced. The rejection is
// an InvoicePdfError whose `reason` is the converter's typed failure reason, so
// a caller that wants to can tell "this install has no converter" from a fault.

import { convertDocument, type ConversionFailureReason } from "@/lib/documents/conversion/convert";
import { renderInvoiceHtml, type InvoiceForPdf } from "@/lib/finance/invoice-html";

export type { InvoiceForPdf, InvoiceIssuer } from "@/lib/finance/invoice-html";

export class InvoicePdfError extends Error {
  readonly reason: ConversionFailureReason;

  constructor(reason: ConversionFailureReason, detail: string) {
    super(`invoice PDF could not be produced (${reason}): ${detail}`);
    this.name = "InvoicePdfError";
    this.reason = reason;
  }
}

export type InvoicePdfDeps = {
  convert?: typeof convertDocument;
};

export async function generateInvoicePdf(invoice: InvoiceForPdf, deps: InvoicePdfDeps = {}): Promise<Buffer> {
  const html = renderInvoiceHtml(invoice);
  const result = await (deps.convert ?? convertDocument)({ input: Buffer.from(html, "utf-8"), from: "html", to: "pdf" });
  if (!result.ok) throw new InvoicePdfError(result.reason, result.error);
  return result.data.bytes;
}

/** Plain-language copy for an invoice PDF failure, for the API and the page. */
export function invoicePdfFailureMessage(reason: ConversionFailureReason): string {
  switch (reason) {
    case "converter-unavailable":
      return "Invoice PDFs need document conversion, which is not available on this install right now.";
    case "timeout":
      return "Creating the invoice PDF took too long. Try again.";
    default:
      return "The invoice PDF could not be created. Try again.";
  }
}

/** HTTP status for an invoice PDF failure: 503 when the converter is absent, else 500. */
export function invoicePdfFailureStatus(reason: ConversionFailureReason): number {
  return reason === "converter-unavailable" ? 503 : 500;
}

export function getInvoicePdfFilename(invoiceRef: string, accountName: string): string {
  const cleanName = accountName.replace(/[^a-zA-Z0-9]/g, "");
  return `Invoice-${invoiceRef}-${cleanName}.pdf`;
}
