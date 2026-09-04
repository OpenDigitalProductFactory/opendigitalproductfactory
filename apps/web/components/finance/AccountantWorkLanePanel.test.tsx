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
import {
  buildBookkeeperAccountantWorkLane,
  type ResolvedAccountantWorkLane,
} from "@/lib/finance/accountant-work-lane";
import { resolveNextStep } from "@/lib/backlog/next-step-pointer";
import type { QuickBooksReadinessConnection } from "@/lib/integrations/quickbooks/readiness";

const CONNECTED: QuickBooksReadinessConnection = {
  status: "connected",
  companyName: "Test Bookkeeping Co",
  realmId: "realm-test",
  lastErrorMsg: null,
  lastTestedAt: "2026-05-19T00:00:00.000Z",
  environment: "sandbox",
};

// The page resolves declared next steps before rendering. Nothing is filed for
// this lane today, so resolve against an empty backlog — the state the panel
// must render honestly rather than as a dead identifier (BI-5BF97BAA).
const declared = buildBookkeeperAccountantWorkLane(CONNECTED);
const noneFiled = new Map();
const lane: ResolvedAccountantWorkLane = {
  ...declared,
  providerBoundaries: declared.providerBoundaries.map((boundary) => ({
    ...boundary,
    nextStep: resolveNextStep(boundary.nextStep, noneFiled),
  })),
  nextWorkflow: {
    ...declared.nextWorkflow,
    nextStep: resolveNextStep(declared.nextWorkflow.nextStep, noneFiled),
  },
};

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
    expect(html).toContain("Entity links and review queue");
    expect(html).toContain("Fee and payout reconciliation");
    expect(html).toContain("Provider ownership decision");
    expect(html).not.toMatch(/BI-[0-9A-F]{8}/);
    expect(html).toContain("source-attributed");
  });
});
