import { describe, expect, it } from "vitest";
import {
  getAccountantLaneRouteHrefs,
  getBookkeeperAccountantWorkLane,
} from "@/lib/finance/accountant-work-lane";

describe("bookkeeper accountant work lane", () => {
  it("maps the current DPF finance routes into one accountant lane", () => {
    const lane = getBookkeeperAccountantWorkLane();
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

  it("keeps AI coworker responsibilities explicit without misclassifying employee approvals", () => {
    const lane = getBookkeeperAccountantWorkLane();

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

  it("derives QuickBooks read and missing entity families from the readiness descriptor", () => {
    const lane = getBookkeeperAccountantWorkLane();
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
    expect(quickBooks?.nextBacklogItemId).toBe("BI-C61B5202");
  });

  it("anchors Stripe and bank feeds as reconciliation dependencies, not replacement claims", () => {
    const lane = getBookkeeperAccountantWorkLane();
    const stripe = lane.providerBoundaries.find((boundary) => boundary.provider === "stripe");
    const bankFeeds = lane.providerBoundaries.find((boundary) => boundary.provider === "bank-feed-provider");

    expect(stripe?.missingCoverage).toContain("QuickBooks reconciliation");
    expect(stripe?.nextBacklogItemId).toBe("BI-07D76D6B");
    expect(bankFeeds?.posture).toBe("not-mapped");
    expect(lane.promotionGuardrail).toContain("dual-run");
  });
});
