import { describe, expect, it } from "vitest";
import { generateInvoicePdf, getInvoicePdfFilename } from "./invoice-pdf";

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

describe("generateInvoicePdf", () => {
  it("returns a Buffer", async () => {
    const result = await generateInvoicePdf(mockInvoice as never);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it("returns a non-empty Buffer", async () => {
    const result = await generateInvoicePdf(mockInvoice as never);
    expect(result.length).toBeGreaterThan(100);
  });

  it("generates valid PDF (starts with %PDF)", async () => {
    const result = await generateInvoicePdf(mockInvoice as never);
    const header = result.subarray(0, 5).toString("ascii");
    expect(header).toBe("%PDF-");
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
