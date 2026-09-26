// The invoice as a standalone, print-styled HTML document (plan 2026-09-08 M5).
//
// This is the source the dpf-doctools engine prints to PDF (lib/invoice-pdf.ts
// hands it to convertDocument with `--from html --to pdf`), the same HTML ->
// engine path document export uses (lib/documents/document-office-export.ts).
//
// Pure and synchronous, so every field and every escape is unit-testable without
// the engine. The engine is LibreOffice's HTML import, so the layout is tables
// and plain CSS it honours (no flexbox, no grid), and the styling follows the
// export pipeline's print convention: no colour values, borders in currentColor.
//
// Money stays `<currency> <amount to 2 dp>`, as the previous invoice rendered it.
// Dates use the shared formatDate (lib/datetime), not a local copy.

import { formatDate } from "@/lib/datetime";

export type InvoiceIssuer = {
  name: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  addressLines?: string[];
  vatNumber?: string | null;
  bank?: {
    bankName?: string | null;
    accountName?: string | null;
    accountNumber?: string | null;
    sortCode?: string | null;
    iban?: string | null;
  } | null;
};

type Numeric = number | { toString(): string };

export type InvoiceForPdf = {
  invoiceRef: string;
  type: string;
  // The issuing business, from the canonical Organization identity
  // (lib/org-identity.ts). Optional so callers that have not yet resolved org
  // identity still render, but every caller supplies it from live DB.
  issuer?: InvoiceIssuer | null;
  status: string;
  issueDate: Date | string;
  dueDate: Date | string;
  currency: string;
  subtotal: Numeric;
  taxAmount: Numeric;
  discountAmount: Numeric;
  totalAmount: Numeric;
  amountPaid: Numeric;
  amountDue: Numeric;
  paymentTerms: string | null;
  notes: string | null;
  // Present on the countersigned copy sent after the customer signs (Phase 1 e-sign).
  signature?: {
    signedByName: string;
    signedByEmail?: string | null;
    signedAt: Date | string;
  } | null;
  account: { name: string };
  contact: { firstName: string | null; lastName: string | null; email: string } | null;
  lineItems: Array<{
    description: string;
    quantity: Numeric;
    unitPrice: Numeric;
    taxRate: Numeric;
    taxAmount: Numeric;
    lineTotal: Numeric;
    sortOrder: number;
  }>;
};

// ─── Formatting (money unchanged from the react-pdf invoice) ────────────────

function fmt(value: Numeric): string {
  const n = typeof value === "number" ? value : parseFloat(value.toString());
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

function toNum(value: Numeric): number {
  return typeof value === "number" ? value : parseFloat(value.toString()) || 0;
}

/** Escape text for an HTML text node or a double-quoted attribute value. */
export function escapeInvoiceHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const e = escapeInvoiceHtml;

// ─── Print styling ───────────────────────────────────────────────────────────

const INVOICE_PRINT_STYLE = [
  "@page{size:A4;margin:17mm}",
  "body{font-family:Helvetica,Arial,sans-serif;font-size:10pt}",
  "table{border-collapse:collapse}",
  "h1{font-size:24pt;letter-spacing:2pt;margin:0}",
  ".label{font-size:9pt;font-weight:bold;letter-spacing:1pt;text-transform:uppercase;margin:0 0 3pt 0}",
  ".name{font-weight:bold;margin:0 0 2pt 0}",
  ".line{margin:0 0 1pt 0}",
  ".block{margin:0 0 18pt 0}",
  ".meta td{padding:0 0 3pt 6pt}",
  ".items{width:100%;margin:12pt 0 0 0}",
  ".items th{font-size:9pt;border-bottom:1pt solid currentColor;padding:4pt 6pt}",
  ".items td{border-bottom:0.5pt solid currentColor;padding:4pt 6pt}",
  ".totals{margin:12pt 0 0 0}",
  ".totals td{padding:2pt 0 2pt 12pt}",
  ".due td{font-size:11pt;font-weight:bold;border-top:1pt solid currentColor;padding-top:4pt}",
  ".footer{border-top:1pt solid currentColor;margin:24pt 0 0 0;padding:8pt 0 0 0}",
  ".footer p{margin:0 0 8pt 0}",
].join("\n");

// ─── Sections ────────────────────────────────────────────────────────────────

const money = (currency: string, value: Numeric): string => `${e(currency)} ${fmt(value)}`;

function metaRow(label: string, value: string): string {
  return `<tr><td align="right"><b>${label}</b></td><td align="right">${e(value)}</td></tr>`;
}

function header(invoice: InvoiceForPdf): string {
  return [
    '<table width="100%" class="block"><tr>',
    '<td valign="top"><h1>INVOICE</h1></td>',
    '<td valign="top" align="right"><table class="meta" align="right">',
    metaRow("Ref:", invoice.invoiceRef),
    metaRow("Issued:", formatDate(invoice.issueDate)),
    metaRow("Due:", formatDate(invoice.dueDate)),
    "</table></td>",
    "</tr></table>",
  ].join("\n");
}

function lines(values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => Boolean(value))
    .map((value) => `<p class="line">${e(value)}</p>`)
    .join("\n");
}

function issuerBlock(issuer: InvoiceIssuer | null | undefined): string {
  if (!issuer) return "";
  return [
    '<div class="block from">',
    '<p class="label">From</p>',
    `<p class="name">${e(issuer.name)}</p>`,
    lines([
      ...(issuer.addressLines ?? []),
      issuer.email,
      issuer.phone,
      issuer.website,
      issuer.vatNumber ? `VAT No: ${issuer.vatNumber}` : null,
    ]),
    "</div>",
  ].join("\n");
}

function billToBlock(invoice: InvoiceForPdf): string {
  const contactName = invoice.contact
    ? [invoice.contact.firstName, invoice.contact.lastName].filter(Boolean).join(" ")
    : null;
  return [
    '<div class="block bill-to">',
    '<p class="label">Bill To</p>',
    `<p class="name">${e(invoice.account.name)}</p>`,
    lines([contactName, invoice.contact?.email]),
    "</div>",
  ].join("\n");
}

function itemsTable(invoice: InvoiceForPdf): string {
  const sorted = [...invoice.lineItems].sort((a, b) => a.sortOrder - b.sortOrder);
  const rows = sorted.map((item) =>
    [
      "<tr>",
      `<td>${e(item.description)}</td>`,
      `<td align="right">${e(item.quantity.toString())}</td>`,
      `<td align="right">${money(invoice.currency, item.unitPrice)}</td>`,
      `<td align="right">${e(item.taxRate.toString())}%</td>`,
      `<td align="right">${money(invoice.currency, item.lineTotal)}</td>`,
      "</tr>",
    ].join(""),
  );
  return [
    '<table class="items">',
    "<thead><tr>",
    '<th align="left" width="40%">DESCRIPTION</th>',
    '<th align="right" width="10%">QTY</th>',
    '<th align="right" width="20%">UNIT PRICE</th>',
    '<th align="right" width="10%">TAX %</th>',
    '<th align="right" width="20%">TOTAL</th>',
    "</tr></thead>",
    "<tbody>",
    ...rows,
    "</tbody></table>",
  ].join("\n");
}

function totalsRow(label: string, value: string, className?: string): string {
  const cls = className ? ` class="${className}"` : "";
  return `<tr${cls}><td align="right">${label}</td><td align="right">${value}</td></tr>`;
}

function totalsTable(invoice: InvoiceForPdf): string {
  const c = invoice.currency;
  const rows = [totalsRow("Subtotal", money(c, invoice.subtotal))];
  if (toNum(invoice.taxAmount) > 0) rows.push(totalsRow("Tax", money(c, invoice.taxAmount)));
  if (toNum(invoice.discountAmount) > 0) rows.push(totalsRow("Discount", `-${money(c, invoice.discountAmount)}`));
  rows.push(totalsRow("Total", money(c, invoice.totalAmount)));
  if (toNum(invoice.amountPaid) > 0) rows.push(totalsRow("Amount Paid", `-${money(c, invoice.amountPaid)}`));
  rows.push(totalsRow("Amount Due", money(c, invoice.amountDue), "due"));
  return ['<table class="totals" align="right">', ...rows, "</table>", '<br clear="all">'].join("\n");
}

function bankLines(issuer: InvoiceIssuer | null | undefined): string[] {
  const bank = issuer?.bank;
  if (!bank) return [];
  return [
    bank.bankName ? `Bank: ${bank.bankName}` : null,
    bank.accountName ? `Account name: ${bank.accountName}` : null,
    bank.accountNumber ? `Account number: ${bank.accountNumber}` : null,
    bank.sortCode ? `Sort code: ${bank.sortCode}` : null,
    bank.iban ? `IBAN: ${bank.iban}` : null,
  ].filter((line): line is string => Boolean(line));
}

function footer(invoice: InvoiceForPdf): string {
  const bank = bankLines(invoice.issuer);
  if (!invoice.paymentTerms && !invoice.notes && bank.length === 0) return "";
  const parts = ['<div class="footer">'];
  if (invoice.paymentTerms) parts.push('<p class="label">Payment Terms</p>', `<p>${e(invoice.paymentTerms)}</p>`);
  if (bank.length > 0) parts.push('<p class="label">Bank Details</p>', ...bank.map((line) => `<p>${e(line)}</p>`));
  if (invoice.notes) parts.push('<p class="label">Notes</p>', `<p>${e(invoice.notes)}</p>`);
  parts.push("</div>");
  return parts.join("\n");
}

function signatureBlock(invoice: InvoiceForPdf): string {
  const signature = invoice.signature;
  if (!signature) return "";
  const email = signature.signedByEmail ? ` (${signature.signedByEmail})` : "";
  const text = `Signed by ${signature.signedByName}${email} on ${formatDate(signature.signedAt)}`;
  return ['<div class="footer signature">', '<p class="label">Signed</p>', `<p>${e(text)}</p>`, "</div>"].join("\n");
}

// ─── Document ────────────────────────────────────────────────────────────────

/** The complete invoice as a standalone HTML document for the dpf-doctools engine. */
export function renderInvoiceHtml(invoice: InvoiceForPdf): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>Invoice ${e(invoice.invoiceRef)}</title>`,
    `<style>${INVOICE_PRINT_STYLE}</style>`,
    "</head><body>",
    header(invoice),
    issuerBlock(invoice.issuer),
    billToBlock(invoice),
    itemsTable(invoice),
    totalsTable(invoice),
    footer(invoice),
    signatureBlock(invoice),
    "</body></html>",
  ]
    .filter(Boolean)
    .join("\n");
}
