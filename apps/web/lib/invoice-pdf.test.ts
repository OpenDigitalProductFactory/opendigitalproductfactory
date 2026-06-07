import { beforeAll, describe, expect, it } from "vitest";
import { generateInvoicePdf, getInvoicePdfFilename } from "./invoice-pdf";

const PDF_TEST_TIMEOUT_MS = 20_000;

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
  let standardPdf: Buffer;

  beforeAll(async () => {
    standardPdf = await generateInvoicePdf(mockInvoice as never);
  }, PDF_TEST_TIMEOUT_MS);

  it("returns a Buffer", () => {
    const result = standardPdf;
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it("returns a non-empty Buffer", () => {
    const result = standardPdf;
    expect(result.length).toBeGreaterThan(100);
  });

  it("generates valid PDF (starts with %PDF)", () => {
    const result = standardPdf;
    const header = result.subarray(0, 5).toString("ascii");
    expect(header).toBe("%PDF-");
  });

  it("generates a valid PDF when an issuer (org identity) is supplied", async () => {
    const withIssuer = {
      ...mockInvoice,
      issuer: {
        name: "Acme Trading Ltd",
        email: "billing@acme.example",
        addressLines: ["1 High St", "London", "EC1A 1BB"],
        vatNumber: "GB123456789",
        bank: { bankName: "Big Bank", accountName: "Acme Current", accountNumber: "12345678", sortCode: "12-34-56", iban: null },
      },
    };
    const result = await generateInvoicePdf(withIssuer as never);
    expect(result.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(result.length).toBeGreaterThan(100);
  }, PDF_TEST_TIMEOUT_MS);
});

describe("getInvoicePdfFilename", () => {
  it("generates correct filename", () => {
    expect(getInvoicePdfFilename("INV-2026-0001", "Acme Corp")).toBe("Invoice-INV-2026-0001-AcmeCorp.pdf");
  });

  it("strips special characters from account name", () => {
    expect(getInvoicePdfFilename("INV-2026-0002", "O'Brien & Co.")).toBe("Invoice-INV-2026-0002-OBrienCo.pdf");
  });
});
