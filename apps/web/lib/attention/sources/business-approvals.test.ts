import { describe, it, expect, vi } from "vitest";
import {
  leaveApprovalToAttentionItem,
  loadLeaveApprovalItems,
  outboundToAttentionItem,
  billToAttentionItem,
  expenseToAttentionItem,
  regulatoryToAttentionItem,
  researchToAttentionItem,
} from "./business-approvals";
import { isOverrideTier } from "../triage";

const NOW = new Date("2026-06-23T12:00:00.000Z").getTime();

describe("billToAttentionItem", () => {
  const base = {
    id: "bill_ckabc123",
    billRef: "BILL-2026-0001",
    currency: "GBP",
    amountDue: "500.00",
    createdAt: new Date("2026-06-20T10:00:00.000Z"),
  };

  it("floats an overdue bill into the override tier with the amount as context", () => {
    const item = billToAttentionItem({ ...base, dueDate: new Date("2026-06-22T10:00:00.000Z") }, NOW);
    expect(item.source).toBe("approval-bill");
    expect(item.triage.timeToAct).toBe("overdue");
    expect(item.triage.deadlineIso).toBe("2026-06-22T10:00:00.000Z");
    expect(isOverrideTier(item)).toBe(true);
    expect(item.context).toBe("GBP 500.00 due");
    expect(item.triage.residueReason).toBe("policy-approval");
  });

  it("deep-links Review bill to the exact bill detail, not the list (BI-1336126B)", () => {
    const item = billToAttentionItem({ ...base, dueDate: new Date("2026-06-22T10:00:00.000Z") }, NOW);
    expect(item.actions).toHaveLength(1);
    expect(item.actions[0].label).toBe("Review bill");
    expect(item.actions[0].href).toBe("/finance/bills/bill_ckabc123");
    expect(item.deepLink).toBe("/finance/bills/bill_ckabc123");
    // Never the generic list route the owner had to re-search.
    expect(item.actions[0].href).not.toBe("/finance/bills");
  });

  it("leaves a far-off bill in the normal tier", () => {
    const item = billToAttentionItem({ ...base, dueDate: new Date("2026-08-01T10:00:00.000Z") }, NOW);
    expect(item.triage.timeToAct).toBe("none");
    expect(isOverrideTier(item)).toBe(false);
  });
});

describe("regulatoryToAttentionItem", () => {
  const base = {
    id: "rs_ck0001",
    submissionId: "RS-1",
    title: "Quarterly VAT return",
    recipientBody: "HMRC",
    submissionType: "tax-return",
    createdAt: new Date("2026-06-20T10:00:00.000Z"),
  };

  it("is high-risk and floats to the override tier when due today", () => {
    const item = regulatoryToAttentionItem({ ...base, dueDate: new Date("2026-06-23T20:00:00.000Z") }, NOW);
    expect(item.source).toBe("compliance-submission");
    expect(item.riskClass).toBe("high-risk");
    expect(item.triage.timeToAct).toBe("due-today");
    expect(isOverrideTier(item)).toBe(true);
    expect(item.actions[0].href).toBe("/compliance/submissions/rs_ck0001");
    expect(item.deepLink).toBe("/compliance/submissions/rs_ck0001");
  });

  it("handles a submission with no deadline", () => {
    const item = regulatoryToAttentionItem({ ...base, dueDate: null }, NOW);
    expect(item.triage.timeToAct).toBe("none");
    expect(item.triage.deadlineIso).toBeUndefined();
  });
});

describe("the no-deadline business approvals", () => {
  it("maps an outbound draft", () => {
    const item = outboundToAttentionItem({
      draftId: "OD-1",
      channelId: "linkedin",
      assetType: "linkedin-post",
      body: "Big news this week...",
      createdAt: new Date("2026-06-23T09:00:00.000Z"),
    });
    expect(item.source).toBe("approval-outbound");
    expect(item.riskClass).toBe("bounded-write");
    expect(item.title).toBe("Approve linkedin-post for linkedin");
  });

  it("maps an expense claim, preferring submittedAt for age", () => {
    const item = expenseToAttentionItem({
      id: "ec_ck77",
      claimId: "EC-1",
      title: "Client dinner",
      currency: "USD",
      totalAmount: "82.50",
      submittedAt: new Date("2026-06-22T18:00:00.000Z"),
      createdAt: new Date("2026-06-21T18:00:00.000Z"),
    });
    expect(item.id).toBe("approval-expense:EC-1");
    expect(item.createdAtIso).toBe("2026-06-22T18:00:00.000Z");
    expect(item.context).toBe("USD 82.50");
    expect(item.actions[0].href).toBe("/finance/expense-claims/ec_ck77");
    expect(item.deepLink).toBe("/finance/expense-claims/ec_ck77");
  });

  it("maps a research proposal as low-risk", () => {
    const item = researchToAttentionItem({
      proposalId: "RP-1",
      topic: "competitive-landscape",
      query: "Who are the top 5 competitors and their pricing?",
      proposedAt: new Date("2026-06-23T07:00:00.000Z"),
    });
    expect(item.source).toBe("research-proposal");
    expect(item.riskClass).toBe("read");
    expect(item.title).toBe("Approve research: competitive-landscape");
  });
});

// PR-B (BI-7BCC87BB; spec D2 S5, AC-LEAVE): a time-off decision is the
// manager's own business approval, so its Needs-you item lives here, one per
// pending request (keyed by requestId), not on the proposal source. Audience
// unchanged (operator view; FU-8 records the scoping gap).
describe("leaveApprovalToAttentionItem", () => {
  const row = {
    requestId: "LR-1",
    leaveType: "vacation",
    days: 2,
    startDate: new Date("2026-08-20T00:00:00.000Z"),
    createdAt: new Date("2026-08-12T00:00:00.000Z"),
    decisionInteractionId: "DI-1" as string | null,
    employeeName: "Ada Lovelace",
  };

  it("one item per pending request, linking to the time-off page", () => {
    const item = leaveApprovalToAttentionItem(row);
    expect(item.id).toBe("approval-leave:LR-1");
    expect(item.source).toBe("approval-leave");
    expect(item.title).toBe("Decide time off for Ada Lovelace");
    expect(item.context).toBe("2 day(s) of vacation from 2026-08-20. The time-off advisor has a recommendation.");
    expect(item.deepLink).toBe("/employee?view=timeoff");
    expect(item.actions).toEqual([{ kind: "open-in-context", label: "Review time off", href: "/employee?view=timeoff" }]);
    expect(item.audience).toEqual({ operator: true });
    expect(item.triage.residueReason).toBe("policy-approval");
  });

  it("says nothing about a recommendation when none was recorded", () => {
    expect(leaveApprovalToAttentionItem({ ...row, decisionInteractionId: null }).context).toBe("2 day(s) of vacation from 2026-08-20.");
  });

  it("loads pending requests only", async () => {
    const findMany = vi.fn(async () => [{ ...row, employeeProfile: { displayName: "Ada Lovelace" } }]);
    const items = await loadLeaveApprovalItems({ leaveRequest: { findMany } } as never);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "pending" } }));
    expect(items.map((item) => item.id)).toEqual(["approval-leave:LR-1"]);
  });
});
