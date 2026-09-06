import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RecentInvoicesTable, type RecentInvoiceRow } from "./RecentInvoicesTable";

const ROWS: RecentInvoiceRow[] = [
  { id: "i1", invoiceRef: "INV-001", accountName: "Acme Ltd", status: "overdue", amount: 1200 },
  { id: "i2", invoiceRef: "INV-002", accountName: "Globex", status: "paid", amount: 50.5 },
  { id: "i3", invoiceRef: "INV-003", accountName: "Initech", status: "partially_paid", amount: 300 },
];

describe("RecentInvoicesTable (report-kit migration)", () => {
  const html = renderToStaticMarkup(<RecentInvoicesTable rows={ROWS} currencySymbol="£" />);

  it("renders invoice rows with drill-down links", () => {
    expect(html).toContain("INV-001");
    expect(html).toContain('href="/finance/invoices/i1"');
    expect(html).toContain("Acme Ltd");
  });

  it("renders status via the finance registry StatusBadge (no raw hex)", () => {
    expect(html).toContain('data-intent="danger"'); // overdue
    expect(html).toContain('data-intent="success"'); // paid
    expect(html).toContain('data-intent="warning"'); // partially_paid
    expect(html).toContain("partially paid"); // underscore replaced
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("formats amounts with the currency symbol", () => {
    expect(html).toContain("£1,200.00");
    expect(html).toContain("£50.50");
  });

  it("can present internal invoice rows as Pet Rescue contributions", () => {
    const rescueHtml = renderToStaticMarkup(
      <RecentInvoicesTable
        rows={ROWS}
        currencySymbol="$"
        accountHeader="Supporter or funder"
        emptyLabel="No contributions yet."
      />,
    );

    expect(rescueHtml).toContain("Supporter or funder");
    expect(rescueHtml).not.toContain(">Account<");
  });
});
