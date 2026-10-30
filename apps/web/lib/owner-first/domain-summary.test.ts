import { describe, it, expect } from "vitest";
import {
  buildCustomerOwnerSummary,
  buildEmployeeOwnerSummary,
  buildFinanceOwnerSummary,
  buildWorkspaceStorefrontSummary,
  hasOwnerFirstAction,
} from "./domain-summary";
import { resolveOwnerVocabulary } from "./vocabulary";

const restaurant = resolveOwnerVocabulary("food-hospitality");
const neutral = resolveOwnerVocabulary("retail-goods");
const petRescue = resolveOwnerVocabulary("nonprofit-community", "pet-rescue");

describe("buildCustomerOwnerSummary", () => {
  it("excludes closed and future-scheduled deals and bounds the primary list", () => {
    const now = new Date("2026-10-30T00:00:00Z");
    const summary = buildCustomerOwnerSummary({
      pendingReservations: 0, pendingOrders: 0, newInquiries: 0,
      unworkedEngagements: 0, overdueInvoices: 0, renewalsDueSoon: 0, now,
      opportunityFollowups: [
        { id: "won", title: "Won", stage: "closed_won", nextActivityAt: null },
        { id: "lost", title: "Lost", stage: "closed_lost", nextActivityAt: new Date("2026-10-01") },
        { id: "future", title: "Scheduled", stage: "proposal", nextActivityAt: new Date("2026-11-01") },
        ...[1, 2, 3, 4].map((id) => ({ id: String(id), title: `Open ${id}`, stage: "qualification", nextActivityAt: null })),
      ],
    }, neutral);
    expect(summary.actions.map((action) => action.title)).toEqual(["Open 1", "Open 2", "Open 3"]);
  });

  it("surfaces recorded overdue and missing sales next steps even without inbound replies", () => {
    const input = {
      pendingReservations: 0, pendingOrders: 0, newInquiries: 0,
      unworkedEngagements: 0, overdueInvoices: 0, renewalsDueSoon: 0,
      now: new Date("2026-10-30T00:00:00Z"),
      opportunityFollowups: [
        { id: "missing", title: "New prospect", stage: "qualification", nextActivityAt: null },
        { id: "late", title: "Existing prospect", stage: "discovery", nextActivityAt: new Date("2026-10-01T00:00:00Z") },
      ],
    };
    const summary = buildCustomerOwnerSummary(input, neutral);
    expect(summary.actions).toHaveLength(2);
    expect(summary.actions[0].title).toContain("Existing prospect");
    expect(summary.actions[0].why).toMatch(/overdue/i);
    expect(summary.actions[1].why).toMatch(/no next step/i);
    expect(summary.actions.map((action) => action.nextAction)).toEqual([
      { label: "Set next step", href: "/customer/opportunities?opportunity=late" },
      { label: "Set next step", href: "/customer/opportunities?opportunity=missing" },
    ]);
    expect(summary.subhead).toMatch(/reply|replies/i);
    expect(summary.subhead).not.toMatch(/no.*follow.up.*needed/i);
  });

  it("describes the genuinely clear state in terms of replies and recorded sales steps", () => {
    const summary = buildCustomerOwnerSummary({
      pendingReservations: 0, pendingOrders: 0, newInquiries: 0,
      unworkedEngagements: 0, overdueInvoices: 0, renewalsDueSoon: 0,
      opportunityFollowups: [],
    }, neutral);
    expect(summary.actions).toHaveLength(0);
    expect(summary.clearMessage).toMatch(/reply|replies/i);
    expect(summary.clearMessage).toMatch(/sales.*next step/i);
  });

  it("leads with guest follow-up in restaurant language and orders by urgency", () => {
    const summary = buildCustomerOwnerSummary(
      {
        pendingReservations: 3,
        pendingOrders: 1,
        newInquiries: 2,
        unworkedEngagements: 4,
        overdueInvoices: 1,
        renewalsDueSoon: 0,
      },
      restaurant,
    );
    expect(summary.headline).toBe("Guest follow-up");
    // Reservations are the most urgent → first.
    expect(summary.actions[0].id).toBe("reservations");
    expect(summary.actions[0].tone).toBe("urgent");
    // Every action carries a safest next action.
    for (const action of summary.actions) {
      expect(action.nextAction.href).toMatch(/^\//);
      expect(action.nextAction.label.length).toBeGreaterThan(0);
      expect(action.why.length).toBeGreaterThan(0);
    }
    expect(hasOwnerFirstAction(summary)).toBe(true);
  });

  it("explains why the surface is clear when nothing is waiting", () => {
    const summary = buildCustomerOwnerSummary(
      {
        pendingReservations: 0,
        pendingOrders: 0,
        newInquiries: 0,
        unworkedEngagements: 0,
        overdueInvoices: 0,
        renewalsDueSoon: 0,
      },
      restaurant,
    );
    expect(summary.actions).toHaveLength(0);
    expect(hasOwnerFirstAction(summary)).toBe(false);
    expect(summary.clearMessage).toMatch(/guests/i);
  });

  it("uses neutral customer language off-archetype", () => {
    const summary = buildCustomerOwnerSummary(
      {
        pendingReservations: 1,
        pendingOrders: 0,
        newInquiries: 0,
        unworkedEngagements: 0,
        overdueInvoices: 0,
        renewalsDueSoon: 0,
      },
      neutral,
    );
    expect(summary.headline).toBe("Customer follow-up");
    expect(summary.subhead).toMatch(/customers/i);
  });

  it("keeps the pet-rescue follow-up band free of customer and CRM language", () => {
    const summary = buildCustomerOwnerSummary(
      {
        pendingReservations: 0,
        pendingOrders: 0,
        newInquiries: 4,
        unworkedEngagements: 0,
        overdueInvoices: 0,
        renewalsDueSoon: 0,
      },
      petRescue,
    );
    expect(summary.headline).toBe("Adoption follow-up");
    expect(summary.subhead).not.toMatch(/customer|crm/i);
    expect(summary.actions[0]?.title).toBe("4 new adoption enquiries to answer");
  });
});

describe("buildFinanceOwnerSummary", () => {
  it("leads with bills to pay and names the money owed to you", () => {
    const summary = buildFinanceOwnerSummary(
      {
        billsDue: 2,
        overdueInvoices: 3,
        pendingExpenses: 1,
        oldestOverdueName: "Ada Bistro",
        currencySymbol: "£",
        moneyOwedToYou: 4200,
      },
      restaurant,
    );
    expect(summary.actions[0].id).toBe("bills");
    expect(summary.actions[0].tone).toBe("urgent");
    const collect = summary.actions.find((a) => a.id === "collect");
    expect(collect?.why).toContain("£4,200");
    expect(collect?.why).toContain("Ada Bistro");
  });

  it("is clear when there is no money work today", () => {
    const summary = buildFinanceOwnerSummary(
      {
        billsDue: 0,
        overdueInvoices: 0,
        pendingExpenses: 0,
        oldestOverdueName: null,
        currencySymbol: "£",
        moneyOwedToYou: 0,
      },
      restaurant,
    );
    expect(summary.actions).toHaveLength(0);
    expect(summary.clearMessage).toMatch(/nothing needs/i);
  });
});

describe("buildEmployeeOwnerSummary", () => {
  it("leads with service readiness and surfaces timesheets to approve", () => {
    const summary = buildEmployeeOwnerSummary(
      { submittedTimesheets: 2, teamSize: 8, unassignedRoles: 1 },
      restaurant,
    );
    expect(summary.headline).toBe("Next service readiness");
    expect(summary.actions[0].id).toBe("timesheets");
    expect(summary.subhead).toMatch(/service staff of 8/);
  });

  it("is clear (team set) with an explanation when nothing needs sign-off", () => {
    const summary = buildEmployeeOwnerSummary(
      { submittedTimesheets: 0, teamSize: 5, unassignedRoles: 0 },
      restaurant,
    );
    expect(summary.actions).toHaveLength(0);
    expect(summary.clearMessage).toMatch(/set for the next service/i);
  });
});

describe("buildWorkspaceStorefrontSummary", () => {
  it("reframes storefront signals as owner-first guest work", () => {
    const summary = buildWorkspaceStorefrontSummary(
      { pendingReservations: 12, newInquiries: 1, pendingOrders: 0 },
      restaurant,
    );
    expect(summary.domain).toBe("workspace");
    expect(summary.headline).toBe("From your guests");
    expect(summary.actions[0].id).toBe("reservations");
    expect(hasOwnerFirstAction(summary)).toBe(true);
  });

  it("has no actions when the storefront is quiet", () => {
    const summary = buildWorkspaceStorefrontSummary(
      { pendingReservations: 0, newInquiries: 0, pendingOrders: 0 },
      neutral,
    );
    expect(hasOwnerFirstAction(summary)).toBe(false);
  });
});
