import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { OwnerFirstFinanceView, type MoneyJobMetric } from "./OwnerFirstFinanceView";
import { resolveFinanceSurface, type FinanceMetricKey } from "@/lib/finance/finance-surface";

const surface = resolveFinanceSurface("food-hospitality");

const metrics: Partial<Record<FinanceMetricKey, MoneyJobMetric>> = {
  "outstanding-receivables": { value: "£1,250.00", hint: "3 invoices outstanding" },
  "money-in-month": { value: "£8,400.00", hint: "42 invoices paid this month" },
  "overdue-count": { value: "2", hint: "oldest: Table 12" },
  "supplier-bills-due": { value: "£640.00", hint: "5 bills awaiting payment" },
  "cash-position": { value: "£12,000.00", hint: "across 2 accounts" },
};

function render() {
  return renderToStaticMarkup(
    <OwnerFirstFinanceView
      surface={surface}
      metrics={metrics}
      advancedChildren={<div>ACCOUNTANT_WORK_LANE_MARKER</div>}
    />,
  );
}

describe("OwnerFirstFinanceView", () => {
  it("leads with the money question and foregrounds Restaurant money jobs", () => {
    const html = render();
    expect(html).toContain("What money needs attention today?");
    expect(html).toContain("Deposits &amp; event balances");
    expect(html).toContain("Order &amp; ticket payments");
    expect(html).toContain("Supplier bills");
    expect(html).toContain("Payouts &amp; reconciliation");
    expect(html).toContain("No-show &amp; cancellation fees");
  });

  it("renders the live figures for each money job", () => {
    const html = render();
    expect(html).toContain("£1,250.00");
    expect(html).toContain("£8,400.00");
    expect(html).toContain("£640.00");
    expect(html).toContain("£12,000.00");
  });

  it("offers Restaurant invoice entry points instead of only a customer dropdown", () => {
    const html = render();
    expect(html).toContain("From a booking");
    expect(html).toContain("Catering order");
    expect(html).toContain("Private event");
    expect(html).toContain('href="/finance/invoices/new?from=booking"');
  });

  it("does NOT lead with accountant/internal sections — they sit inside the advanced region", () => {
    const html = render();

    // The money jobs must appear before the deferred "Accounting & admin" block.
    const firstMoneyJob = html.indexOf("Deposits &amp; event balances");
    const advancedHeading = html.indexOf("Accounting &amp; admin");
    const accountantLane = html.indexOf("ACCOUNTANT_WORK_LANE_MARKER");

    expect(firstMoneyJob).toBeGreaterThan(-1);
    expect(advancedHeading).toBeGreaterThan(firstMoneyJob);
    expect(accountantLane).toBeGreaterThan(advancedHeading);

    // The internals live under a collapsed <details> summary, not at the top.
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
  });

  it("keeps VAT, dunning, payment runs, GL, bank rules, and AI spend links available (deferred, not dropped)", () => {
    const html = render();
    for (const href of [
      "/finance/reports/vat-summary",
      "/finance/settings/dunning",
      "/finance/payment-runs",
      "/finance/reports/general-ledger",
      "/finance/banking/rules",
      "/finance/spend/ai",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });
});
