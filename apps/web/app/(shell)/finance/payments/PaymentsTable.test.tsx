import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PaymentsTable, type PaymentRow } from "./PaymentsTable";

const ROWS: PaymentRow[] = [
  {
    id: "p1",
    paymentRef: "PMT-001",
    method: "card",
    direction: "inbound",
    documentId: "inv1",
    documentRef: "INV-100",
    documentType: "invoice",
    dateISO: "2026-03-28T14:30:00.000Z",
    amount: 1234.5,
  },
  {
    id: "p2",
    paymentRef: "PMT-002",
    method: "transfer",
    direction: "outbound",
    documentId: "bill1",
    documentRef: "BILL-200",
    documentType: "bill",
    dateISO: "2026-03-27T09:00:00.000Z",
    amount: 50,
  },
];

describe("PaymentsTable (report-kit migration)", () => {
  const html = renderToStaticMarkup(<PaymentsTable rows={ROWS} currencySymbol="£" />);

  it("renders rows with refs and a linked invoice", () => {
    expect(html).toContain("PMT-001");
    expect(html).toContain('href="/finance/invoices/inv1"');
    expect(html).toContain("INV-100");
  });

  it("renders outbound bill allocations with a bill link", () => {
    expect(html).toContain("PMT-002");
    expect(html).toContain('href="/finance/bills/bill1"');
    expect(html).toContain("BILL-200");
  });

  it("renders direction via token-backed StatusBadge (no raw hex)", () => {
    // inbound → success, outbound → warning
    expect(html).toContain('data-intent="success"');
    expect(html).toContain('data-intent="warning"');
    expect(html).not.toMatch(/#(4ade80|f97316)/i);
  });

  it("formats money with the currency symbol", () => {
    expect(html).toContain("£1,234.50");
    expect(html).toContain("£50.00");
  });

  it("renders the document column instead of an invoice-only column", () => {
    expect(html).toContain("Document");
    expect(html).not.toContain(">Invoice<");
  });
});
