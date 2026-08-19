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

import { AccountantWorkLanePanel } from "./AccountantWorkLanePanel";
import { buildBookkeeperAccountantWorkLane } from "@/lib/finance/accountant-work-lane";
import type { QuickBooksReadinessConnection } from "@/lib/integrations/quickbooks/readiness";

const CONNECTED: QuickBooksReadinessConnection = {
  status: "connected",
  companyName: "Test Bookkeeping Co",
  realmId: "realm-test",
  lastErrorMsg: null,
  lastTestedAt: "2026-05-19T00:00:00.000Z",
  environment: "sandbox",
};

const lane = buildBookkeeperAccountantWorkLane(CONNECTED);

describe("AccountantWorkLanePanel", () => {
  it("renders the bookkeeper accountant lane with current DPF finance routes", () => {
    const html = renderToStaticMarkup(<AccountantWorkLanePanel lane={lane} />);

    expect(html).toContain("Bookkeeper / Accountant");
    expect(html).toContain("Employee Work Lane");
    expect(html).toContain('href="/finance/invoices"');
    expect(html).toContain('href="/finance/bills"');
    expect(html).toContain('href="/finance/banking"');
    expect(html).toContain('href="/finance/reports"');
    expect(html).toContain("for_employees/financial_management");
  });

  it("renders coworker responsibilities and missing specialist handoff", () => {
    const html = renderToStaticMarkup(<AccountantWorkLanePanel lane={lane} />);

    expect(html).toContain("finance-agent");
    expect(html).toContain("finance-controller");
    expect(html).toContain("Future bookkeeper/accountant specialist");
    expect(html).toContain("Proposal mode only");
    expect(html).toContain("Accountant review gates");
  });

  it("renders QuickBooks, Stripe, missing coverage, and next backlog slices", () => {
    const html = renderToStaticMarkup(<AccountantWorkLanePanel lane={lane} />);

    expect(html).toContain('href="/platform/tools/integrations/quickbooks"');
    expect(html).toContain('href="/platform/tools/integrations/stripe"');
    expect(html).toContain("QuickBooks Online");
    expect(html).toContain("Stripe Billing &amp; Payments");
    expect(html).toContain("Vendors");
    expect(html).toContain("Bank transactions");
    expect(html).toContain("QuickBooks reconciliation");
    expect(html).toContain("BI-4025EF5F");
    expect(html).toContain("BI-2DB52EAB");
    expect(html).toContain("BI-47366954");
    expect(html).toContain("source-attributed");
  });
});
