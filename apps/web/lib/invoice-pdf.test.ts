import { describe, expect, it, vi } from "vitest";
import type { ConversionResult, ConvertRequest } from "@/lib/documents/conversion/convert";
import {
  generateInvoicePdf,
  getInvoicePdfFilename,
  InvoicePdfError,
  invoicePdfFailureMessage,
  invoicePdfFailureStatus,
} from "./invoice-pdf";

const mockInvoice = {
  invoiceRef: "INV-2026-0001",
  type: "standard",
  status: "sent",
  issueDate: new Date("2026-03-20"),
  dueDate: new Date("2026-04-20"),
  currency: "GBP",
  subtotal: 300,
  taxAmount: 60,
  discountAmount: 0,
  totalAmount: 360,
  amountPaid: 0,
  amountDue: 360,
  paymentTerms: "Net 30",
  notes: "Thank you for your business",
  account: { name: "Acme Corp" },
  contact: { firstName: "Jane", lastName: "Doe", email: "jane@acme.com" },
  lineItems: [
    { description: "Consulting", quantity: 2, unitPrice: 150, taxRate: 20, taxAmount: 60, lineTotal: 360, sortOrder: 0 },
  ],
};

const PDF_BYTES = Buffer.from("%PDF-1.7\n...");

describe("generateInvoicePdf", () => {
  it("prints the invoice HTML to PDF through the converter and returns its bytes", async () => {
    const requests: ConvertRequest[] = [];
    const convert = vi.fn(async (request: ConvertRequest): Promise<ConversionResult> => {
      requests.push(request);
      return { ok: true, data: { bytes: PDF_BYTES, mime: "application/pdf" } };
    });
    const result = await generateInvoicePdf(mockInvoice, { convert });

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result).toBe(PDF_BYTES);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.from).toBe("html");
    expect(requests[0]!.to).toBe("pdf");
    const html = requests[0]!.input.toString("utf-8");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("INV-2026-0001");
    expect(html).toContain("GBP 360.00");
  });

  it("rejects with a typed InvoicePdfError when the converter fails", async () => {
    const convert = vi.fn(async (): Promise<ConversionResult> => ({
      ok: false,
      error: "no dpf-doctools image is configured",
      reason: "converter-unavailable",
    }));
    const failure = await generateInvoicePdf(mockInvoice, { convert }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InvoicePdfError);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as InvoicePdfError).reason).toBe("converter-unavailable");
    expect((failure as InvoicePdfError).message).toContain("no dpf-doctools image is configured");
  });
});

describe("invoice PDF failure mapping", () => {
  it("reports an absent converter as 503 with plain-language copy", () => {
    expect(invoicePdfFailureStatus("converter-unavailable")).toBe(503);
    expect(invoicePdfFailureMessage("converter-unavailable")).toMatch(/document conversion/);
  });

  it("reports every other failure as 500", () => {
    for (const reason of ["timeout", "input-too-large", "conversion-failed"] as const) {
      expect(invoicePdfFailureStatus(reason)).toBe(500);
      expect(invoicePdfFailureMessage(reason)).toMatch(/invoice PDF/);
    }
  });
});

describe("getInvoicePdfFilename", () => {
  it("generates correct filename", () => {
    expect(getInvoicePdfFilename("INV-2026-0001", "Acme Corp")).toBe("Invoice-INV-2026-0001-AcmeCorp.pdf");
  });

  it("strips special characters from account name", () => {
    expect(getInvoicePdfFilename("INV-2026-0002", "O'Brien & Co.")).toBe("Invoice-INV-2026-0002-OBrienCo.pdf");
  });
});
