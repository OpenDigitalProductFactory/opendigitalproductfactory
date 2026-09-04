import { describe, expect, it } from "vitest";
import {
  buildBookkeeperAccountantWorkLane,
  getAccountantLaneRouteHrefs,
} from "@/lib/finance/accountant-work-lane";
import type { QuickBooksReadinessConnection } from "@/lib/integrations/quickbooks/readiness";

const CONNECTED: QuickBooksReadinessConnection = {
  status: "connected",
  companyName: "Test Bookkeeping Co",
  realmId: "realm-test",
  lastErrorMsg: null,
  lastTestedAt: "2026-05-19T00:00:00.000Z",
  environment: "sandbox",
};

const UNCONFIGURED: QuickBooksReadinessConnection = {
  status: "unconfigured",
  companyName: null,
  realmId: null,
  lastErrorMsg: null,
  lastTestedAt: null,
  environment: null,
};

describe("bookkeeper accountant work lane", () => {
  it("maps the current DPF finance routes into one accountant lane", () => {
    const lane = buildBookkeeperAccountantWorkLane(CONNECTED);
    const routes = getAccountantLaneRouteHrefs(lane);

    expect(lane.roleLabel).toBe("Bookkeeper / Accountant");
    expect(lane.taxonomyNodeId).toBe("for_employees/financial_management");
    expect(routes).toEqual(
      expect.arrayContaining([
        "/finance/invoices",
        "/finance/payments",
        "/finance/bills",
        "/finance/suppliers",
        "/finance/expense-claims",
        "/finance/purchase-orders",
        "/finance/banking",
        "/finance/reports",
        "/finance/close",
      ]),
    );
  });

  it("maps the tax remittance surface to its Workforce digital product", () => {
    const lane = buildBookkeeperAccountantWorkLane(CONNECTED);
    const taxStream = lane.workstreams.find((stream) => stream.key === "banking-close");

    expect(taxStream).toMatchObject({
      digitalProductId: "dpf-tax-remittance",
      taxonomyNodeId: "for_employees/financial_management/manage_taxes",
    });
    expect(taxStream?.routes.map((route) => route.href)).toContain("/finance/settings/tax");
  });

  it("keeps AI coworker responsibilities explicit without misclassifying employee approvals", () => {
    const lane = buildBookkeeperAccountantWorkLane(CONNECTED);

    expect(lane.handoffs.map((handoff) => handoff.actorId)).toEqual(
      expect.arrayContaining([
        "finance-agent",
        "finance-controller",
        "owner_operator",
        "future-bookkeeper-accountant-specialist",
      ]),
    );
    expect(lane.handoffs.find((handoff) => handoff.actorId === "finance-agent")?.actorKind).toBe("ai-coworker");
    expect(lane.handoffs.find((handoff) => handoff.actorId === "owner_operator")?.actorKind).toBe("employee-role");
    expect(lane.handoffs.find((handoff) => handoff.actorId === "finance-agent")?.boundary).toContain(
      "Proposal mode only",
    );
  });

  it("derives QuickBooks import-ready and missing entity families from a connected readiness descriptor", () => {
    const lane = buildBookkeeperAccountantWorkLane(CONNECTED);
    const quickBooks = lane.providerBoundaries.find((boundary) => boundary.provider === "quickbooks");

    expect(quickBooks?.currentCoverage).toEqual([
      "Company profile",
      "Customers",
      "Invoices",
      "Vendors",
      "Bills",
      "Expenses",
      "Payments",
      "Accounts",
      "Reports",
    ]);
    expect(quickBooks?.missingCoverage).toEqual(
      expect.arrayContaining([
        "Bank transactions",
        "Tax",
        "Accountant workflow",
      ]),
    );
    expect(quickBooks?.writeBoundary).toContain("source-attributed");
    expect(quickBooks?.nextStep).toEqual({ kind: "open", intent: "Entity links and review queue" });
  });

  it("shows NO QuickBooks read coverage when the install has no real connection", () => {
    const lane = buildBookkeeperAccountantWorkLane(UNCONFIGURED);
    const quickBooks = lane.providerBoundaries.find((boundary) => boundary.provider === "quickbooks");

    // The previous fixture hardcoded "connected" and always showed full read
    // coverage. An unconfigured install must show none.
    expect(quickBooks?.currentCoverage).toEqual([]);
    expect(quickBooks?.missingCoverage).toEqual(
      expect.arrayContaining(["Company profile", "Customers", "Invoices"]),
    );
  });

  it("anchors Stripe and bank feeds as reconciliation dependencies, not replacement claims", () => {
    const lane = buildBookkeeperAccountantWorkLane(CONNECTED);
    const stripe = lane.providerBoundaries.find((boundary) => boundary.provider === "stripe");
    const bankFeeds = lane.providerBoundaries.find((boundary) => boundary.provider === "bank-feed-provider");

    expect(stripe?.missingCoverage).toContain("QuickBooks reconciliation");
    expect(stripe?.nextStep).toEqual({ kind: "open", intent: "Fee and payout reconciliation" });
    expect(bankFeeds?.posture).toBe("not-mapped");
    expect(bankFeeds?.nextStep).toEqual({ kind: "open", intent: "Provider ownership decision" });
    expect(lane.promotionGuardrail).toContain("dual-run");
  });
});
