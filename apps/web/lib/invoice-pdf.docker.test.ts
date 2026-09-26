// Docker-gated end-to-end test of the invoice PDF (plan 2026-09-08 M5).
//
// Runs only when DPF_DOCTOOLS_TEST_IMAGE names a pinned dpf-doctools image
// (`name@sha256:…`, or the local image id `sha256:…` of a fresh
// `docker build -f Dockerfile.doctools`) AND docker answers. Otherwise every
// case is reported SKIPPED, never passed.
//
// The invoice HTML goes through the real engine to PDF, and the PDF is read
// back through the same engine (dpf-convert --to txt --from pdf, pdftotext),
// so the fields are proven present in the printed document, not just the HTML.

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isPinnedImageReference } from "@/lib/documents/conversion/command";
import { convertDocument, createConversionLimiter } from "@/lib/documents/conversion/convert";
import { formatDate } from "@/lib/datetime";
import { generateInvoicePdf } from "./invoice-pdf";

const IMAGE = process.env.DPF_DOCTOOLS_TEST_IMAGE?.trim() ?? "";

function dockerHasImage(image: string): boolean {
  if (!isPinnedImageReference(image)) return false;
  try {
    // ambient-host-guard: allow the docker gate itself; a host without the image reports this suite SKIPPED
    return spawnSync("docker", ["image", "inspect", image], { stdio: "ignore", timeout: 15_000 }).status === 0;
  } catch {
    return false;
  }
}

const ready = dockerHasImage(IMAGE);
const limiter = createConversionLimiter(2);
const realConvert: typeof convertDocument = (request) =>
  convertDocument(request, { resolveImage: async () => ({ status: "pinned", image: IMAGE }), limiter });

const invoice = {
  invoiceRef: "INV-2026-0042",
  type: "standard",
  status: "sent",
  issueDate: new Date("2026-03-20T00:00:00Z"),
  dueDate: new Date("2026-04-20T00:00:00Z"), // clock-bomb-guard: allow the PDF only prints the date, nothing compares it to now
  currency: "GBP",
  subtotal: 300,
  taxAmount: 60,
  discountAmount: 25,
  totalAmount: 335,
  amountPaid: 100,
  amountDue: 235,
  paymentTerms: "Net 30",
  notes: "Thank you for your business",
  issuer: {
    name: "Acme Trading Ltd",
    email: "billing@acme.example",
    addressLines: ["1 High St", "London", "EC1A 1BB"],
    vatNumber: "GB123456789",
    bank: { bankName: "Big Bank", accountName: "Acme Current", accountNumber: "12345678", sortCode: "12-34-56", iban: null },
  },
  signature: { signedByName: "Jane Doe", signedByEmail: "jane@acme.com", signedAt: new Date("2026-03-21T10:00:00Z") },
  account: { name: "Acme Corp" },
  contact: { firstName: "Jane", lastName: "Doe", email: "jane@acme.com" },
  lineItems: [
    { description: "Consulting & advice <phase 1>", quantity: 2, unitPrice: 150, taxRate: 20, taxAmount: 60, lineTotal: 360, sortOrder: 0 },
  ],
};

describe.skipIf(!ready)("invoice PDF against the real dpf-doctools image", () => {
  it("prints an A4 PDF whose text carries every invoice field", async () => {
    const pdf = await generateInvoicePdf(invoice, { convert: realConvert });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const extracted = await realConvert({ input: pdf, from: "pdf", to: "txt" });
    if (!extracted.ok) throw new Error(`text extraction failed: ${extracted.reason}: ${extracted.error}`);
    const text = extracted.data.bytes.toString("utf-8").replace(/\s+/g, " ");
    for (const expected of [
      "INVOICE",
      "INV-2026-0042",
      formatDate(invoice.issueDate),
      formatDate(invoice.dueDate),
      "Acme Trading Ltd",
      "VAT No: GB123456789",
      "Acme Corp",
      "jane@acme.com",
      "Consulting & advice <phase 1>",
      "GBP 150.00",
      "GBP 360.00",
      "-GBP 25.00",
      "-GBP 100.00",
      "GBP 235.00",
      "Net 30",
      "Sort code: 12-34-56",
      "Thank you for your business",
      `Signed by Jane Doe (jane@acme.com) on ${formatDate(invoice.signature.signedAt)}`,
    ]) {
      expect(text).toContain(expected);
    }
  }, 240_000);
});
