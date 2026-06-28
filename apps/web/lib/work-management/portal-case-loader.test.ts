import { describe, expect, it } from "vitest";

import {
  loadPortalWorkCaseList,
  type PortalCasePrismaClient,
} from "./portal-case-loader";

type WorkItemFixture = Awaited<ReturnType<PortalCasePrismaClient["workItem"]["findMany"]>>[number];

const bookingItem: WorkItemFixture = {
  id: "row-1",
  itemId: "WI-BOOKING-1",
  sourceType: "booking",
  sourceId: "BK-1",
  title: "Confirm condenser appointment",
  description: "Customer needs a scheduling confirmation.",
  urgency: "urgent",
  effortClass: "short",
  status: "awaiting-input",
  assignedToUserId: null,
  dueAt: new Date("2026-06-29T15:00:00.000Z"),
  createdAt: new Date("2026-06-28T10:00:00.000Z"),
};

function prismaFor(items: WorkItemFixture[]): PortalCasePrismaClient {
  return {
    workItem: {
      findMany: async () => items,
    },
    engagement: {
      findUnique: async ({ where }: { where: { engagementId: string } }) =>
        where.engagementId === "ENG-1"
          ? { account: { id: "acct-1", accountId: "CUST-1", name: "Acme Dental" } }
          : null,
    },
    opportunity: {
      findUnique: async ({ where }: { where: { opportunityId: string } }) =>
        where.opportunityId === "OPP-OTHER"
          ? { account: { id: "acct-2", accountId: "CUST-2", name: "Other Co" } }
          : null,
    },
    storefrontBooking: {
      findUnique: async ({ where }: { where: { bookingRef: string } }) =>
        where.bookingRef === "BK-1" ? { customerContactId: "contact-1" } : null,
    },
    customerContact: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "contact-1"
          ? { account: { id: "acct-1", accountId: "CUST-1", name: "Acme Dental" } }
          : null,
    },
    activity: {
      findUnique: async ({ where }: { where: { activityId: string } }) =>
        where.activityId === "ACT-1"
          ? { account: { id: "acct-1", accountId: "CUST-1", name: "Acme Dental" } }
          : null,
    },
  };
}

describe("portal Work Case loader", () => {
  it("filters Work Cases to the authenticated customer account", async () => {
    const view = await loadPortalWorkCaseList({
      prismaClient: prismaFor([
        bookingItem,
        {
          ...bookingItem,
          id: "row-2",
          itemId: "WI-OPP-1",
          sourceType: "opportunity",
          sourceId: "OPP-OTHER",
          title: "Other customer renewal",
        },
        {
          ...bookingItem,
          id: "row-3",
          itemId: "WI-MANUAL-1",
          sourceType: "manual-task",
          sourceId: "MANUAL-1",
          title: "Internal-only task",
        },
      ]),
      customerAccountId: "CUST-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    expect(view.cases).toHaveLength(1);
    expect(view.cases[0]).toMatchObject({
      caseId: "booking:BK-1",
      title: "Confirm condenser appointment",
      statusLabel: "Needs your response",
      attentionRequired: true,
      sourceLabel: "Storefront booking",
    });
    expect(view.stats).toMatchObject({
      total: 1,
      needsResponse: 1,
      inProgress: 0,
    });
  });

  it("returns customer-safe records without internal refs", async () => {
    const view = await loadPortalWorkCaseList({
      prismaClient: prismaFor([bookingItem]),
      customerAccountId: "CUST-1",
    });

    const serialized = JSON.stringify(view.cases[0]);
    expect(serialized).not.toContain("WI-BOOKING-1");
    expect(serialized).not.toContain("sourceRefs");
    expect(serialized).not.toContain("work-item");
    expect(view.cases[0].href).toBe("/portal/cases#booking-BK-1");
  });
});
