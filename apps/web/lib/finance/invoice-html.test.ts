import { describe, expect, it } from "vitest";
import { escapeInvoiceHtml, renderInvoiceHtml, type InvoiceForPdf } from "./invoice-html";

// A Decimal-shaped value, the way Prisma hands money to the renderer.
const dec = (value: string) => ({ toString: () => value });

const base: InvoiceForPdf = {
  invoiceRef: "INV-2026-0001",
  type: "standard",
  status: "sent",
  issueDate: new Date("2026-03-20T00:00:00Z"),
  dueDate: "2026-04-20T00:00:00Z", // clock-bomb-guard: allow pure renderer, the date is only formatted, never compared to now
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

const issuer = {
  name: "Acme Trading Ltd",
  email: "billing@acme.example",
  phone: "+44 20 7946 0000",
  website: "https://acme.example",
  addressLines: ["1 High St", "London", "EC1A 1BB"],
  vatNumber: "GB123456789",
  bank: { bankName: "Big Bank", accountName: "Acme Current", accountNumber: "12345678", sortCode: "12-34-56", iban: "GB00BIGB12345612345678" },
};

/** Visible text of the document, tags removed and entities decoded, for order checks. */
function text(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("renderInvoiceHtml", () => {
  it("is a standalone UTF-8 HTML document with print styling and no colour values", () => {
    const html = renderInvoiceHtml(base);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Invoice INV-2026-0001</title>");
    expect(html).toContain("@page{size:A4");
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/\b(rgb|hsl)a?\(/i);
    // The engine runs with no network: nothing may point it at a URL.
    expect(html).not.toMatch(/<(img|link|script)\b/i);
  });

  it("renders the header, bill-to, line items, totals and footer fields", () => {
    const t = text(renderInvoiceHtml(base));
    expect(t).toContain("INVOICE");
    expect(t).toContain("Ref: INV-2026-0001");
    expect(t).toContain("Issued: 20 Mar 2026");
    expect(t).toContain("Due: 20 Apr 2026");
    expect(t).toContain("Bill To Acme Corp Jane Doe jane@acme.com");
    expect(t).toContain("DESCRIPTION QTY UNIT PRICE TAX % TOTAL");
    expect(t).toContain("Consulting 2 GBP 150.00 20% GBP 360.00");
    expect(t).toContain("Subtotal GBP 300.00 Tax GBP 60.00 Total GBP 360.00 Amount Due GBP 360.00");
    expect(t).toContain("Payment Terms Net 30");
    expect(t).toContain("Notes Thank you for your business");
    expect(t).not.toContain("Discount");
    expect(t).not.toContain("Amount Paid");
    expect(t).not.toContain("From");
    expect(t).not.toContain("Bank Details");
    expect(t).not.toContain("Signed");
  });

  it("renders the issuer identity and bank details from Organization", () => {
    const t = text(renderInvoiceHtml({ ...base, issuer }));
    expect(t).toContain(
      "From Acme Trading Ltd 1 High St London EC1A 1BB billing@acme.example +44 20 7946 0000 https://acme.example VAT No: GB123456789",
    );
    expect(t).toContain(
      "Bank Details Bank: Big Bank Account name: Acme Current Account number: 12345678 Sort code: 12-34-56 IBAN: GB00BIGB12345612345678",
    );
  });

  it("omits absent issuer lines and an issuer with no bank", () => {
    const t = text(renderInvoiceHtml({ ...base, paymentTerms: null, notes: null, issuer: { name: "Solo Ltd" } }));
    expect(t).toContain("From Solo Ltd Bill To");
    expect(t).not.toContain("VAT No");
    expect(t).not.toContain("Bank Details");
    expect(t).not.toContain("Payment Terms");
    const html = renderInvoiceHtml({ ...base, paymentTerms: null, notes: null });
    expect(html).not.toContain('class="footer"');
  });

  it("formats money exactly as before: currency, space, two decimals, from numbers and Decimals", () => {
    const t = text(
      renderInvoiceHtml({
        ...base,
        currency: "USD",
        subtotal: dec("1234.5"),
        taxAmount: dec("0"),
        discountAmount: dec("10"),
        totalAmount: dec("1224.5"),
        amountPaid: dec("100.456"),
        amountDue: dec("not-a-number"),
        lineItems: [
          { description: "Widget", quantity: dec("1.5"), unitPrice: dec("99.999"), taxRate: dec("17.5"), taxAmount: 0, lineTotal: dec("150"), sortOrder: 0 },
        ],
      }),
    );
    expect(t).toContain("Widget 1.5 USD 100.00 17.5% USD 150.00");
    expect(t).toContain(
      "Subtotal USD 1234.50 Discount -USD 10.00 Total USD 1224.50 Amount Paid -USD 100.46 Amount Due USD 0.00",
    );
    // A zero tax amount hides the Tax row, as before.
    expect(t).not.toMatch(/\bTax USD/);
  });

  it("orders line items by sortOrder", () => {
    const t = text(
      renderInvoiceHtml({
        ...base,
        lineItems: [
          { description: "Second", quantity: 1, unitPrice: 1, taxRate: 0, taxAmount: 0, lineTotal: 1, sortOrder: 2 },
          { description: "First", quantity: 1, unitPrice: 1, taxRate: 0, taxAmount: 0, lineTotal: 1, sortOrder: 1 },
        ],
      }),
    );
    expect(t.indexOf("First")).toBeLessThan(t.indexOf("Second"));
  });

  it("renders the countersignature on a signed copy", () => {
    const t = text(
      renderInvoiceHtml({
        ...base,
        signature: { signedByName: "Jane Doe", signedByEmail: "jane@acme.com", signedAt: "2026-03-21T10:00:00Z" },
      }),
    );
    expect(t).toContain("Signed Signed by Jane Doe (jane@acme.com) on 21 Mar 2026");
    const noEmail = text(renderInvoiceHtml({ ...base, signature: { signedByName: "Jane Doe", signedAt: "2026-03-21T10:00:00Z" } }));
    expect(noEmail).toContain("Signed by Jane Doe on 21 Mar 2026");
  });

  it("escapes every caller-supplied field", () => {
    const hostile = `<script>alert("x")</script>&'`;
    const escaped = "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;";
    const html = renderInvoiceHtml({
      ...base,
      invoiceRef: hostile,
      currency: hostile,
      paymentTerms: hostile,
      notes: hostile,
      account: { name: hostile },
      contact: { firstName: hostile, lastName: null, email: hostile },
      lineItems: [
        { description: hostile, quantity: dec(hostile), unitPrice: 1, taxRate: dec(hostile), taxAmount: 0, lineTotal: 1, sortOrder: 0 },
      ],
      issuer: {
        name: hostile,
        email: hostile,
        phone: hostile,
        website: hostile,
        addressLines: [hostile],
        vatNumber: hostile,
        bank: { bankName: hostile, accountName: hostile, accountNumber: hostile, sortCode: hostile, iban: hostile },
      },
      signature: { signedByName: hostile, signedByEmail: hostile, signedAt: "2026-03-21T10:00:00Z" },
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain(hostile);
    // Every occurrence, counted: ref (title + header) 2, currency on the six money
    // cells shown (unit price, line total, subtotal, tax, total, due) 6, terms 1,
    // notes 1, account 1, contact first name + email 2, description, quantity and
    // tax rate 3, issuer name, address, email, phone, website, VAT 6, bank 5,
    // signature name + email 2.
    expect(html.split(escaped).length - 1).toBe(29);
  });
});

describe("escapeInvoiceHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeInvoiceHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});
