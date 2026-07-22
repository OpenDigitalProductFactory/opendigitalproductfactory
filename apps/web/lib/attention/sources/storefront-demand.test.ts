import { describe, expect, it } from "vitest";

import {
  bookingToAttentionItem,
  displayGuest,
  formatWhen,
  inquiryToAttentionItem,
  isActionableBooking,
  isActionableInquiry,
  loadStorefrontDemandItems,
  type StorefrontBookingRow,
  type StorefrontInquiryRow,
} from "./storefront-demand";

const NOW = Date.UTC(2026, 6, 24, 12, 0, 0); // 2026-07-24T12:00Z

const inquiryRow: StorefrontInquiryRow = {
  id: "inq_1",
  inquiryRef: "ENQ-1042",
  customerName: "Emma Blake",
  customerEmail: "emma@example.com",
  message: "Can you host a party of 8 on Friday?",
  status: "new",
  createdAt: new Date("2026-07-24T09:30:00.000Z"),
};

const bookingRow: StorefrontBookingRow = {
  id: "bk_1",
  bookingRef: "RES-2087",
  customerName: "Tom Ford",
  customerEmail: "tom@example.com",
  scheduledAt: new Date("2026-07-25T19:00:00.000Z"),
  status: "pending",
  overlapQuarantinedAt: null,
  createdAt: new Date("2026-07-24T08:00:00.000Z"),
  provider: { name: "Window table 4" },
};

describe("actionable predicates", () => {
  it("treats new/blank inquiry statuses as actionable and handled ones as not", () => {
    expect(isActionableInquiry("new")).toBe(true);
    expect(isActionableInquiry("")).toBe(true);
    expect(isActionableInquiry("responded")).toBe(false);
    expect(isActionableInquiry("Closed")).toBe(false);
  });

  it("treats pending and quarantined reservations as actionable, confirmed as not", () => {
    expect(isActionableBooking({ status: "pending", overlapQuarantinedAt: null })).toBe(true);
    expect(
      isActionableBooking({ status: "confirmed", overlapQuarantinedAt: new Date(NOW) }),
    ).toBe(true); // double-booking review queue is always actionable
    expect(isActionableBooking({ status: "confirmed", overlapQuarantinedAt: null })).toBe(false);
    expect(isActionableBooking({ status: "completed", overlapQuarantinedAt: null })).toBe(false);
  });
});

describe("formatting helpers", () => {
  it("falls back through name → email local part → generic", () => {
    expect(displayGuest("Emma Blake", "emma@example.com")).toBe("Emma Blake");
    expect(displayGuest(null, "emma@example.com")).toBe("emma");
    expect(displayGuest("  ", "@nolocal")).toBe("A customer");
  });

  it("formats a deterministic UTC when-string", () => {
    expect(formatWhen(new Date("2026-07-25T19:00:00.000Z"))).toBe("Sat 25 Jul 19:00");
  });
});

describe("inquiryToAttentionItem", () => {
  const item = inquiryToAttentionItem(inquiryRow);

  it("projects the five owner facts and one exact action", () => {
    expect(item.source).toBe("storefront-demand");
    expect(item.id).toBe("storefront-demand:inquiry:inq_1");
    expect(item.portfolio).toBe("products-and-services-sold");
    expect(item.triage.residueReason).toBe("customer-waiting");
    // guest, ref, date/time, status all present in the situation line
    expect(item.context).toContain("Emma Blake");
    expect(item.context).toContain("ENQ-1042");
    expect(item.context).toContain("Fri 24 Jul 09:30");
    expect(item.context).toContain("Awaiting reply");
    // exactly one next action, deep-linking the record
    expect(item.actions).toHaveLength(1);
    expect(item.actions[0].href).toBe("/storefront/inbox?entryId=inq_1");
  });
});

describe("bookingToAttentionItem", () => {
  it("projects a pending reservation with guest, table, date/time, status and confirm action", () => {
    const item = bookingToAttentionItem(bookingRow, NOW);
    expect(item.id).toBe("storefront-demand:booking:bk_1");
    expect(item.title).toBe("Confirm Tom Ford's reservation");
    expect(item.context).toBe(
      "Tom Ford · Window table 4 · Sat 25 Jul 19:00 · Ref RES-2087 · Awaiting confirmation",
    );
    expect(item.riskClass).toBe("bounded-write");
    expect(item.triage.irreversible).toBe(false);
    expect(item.triage.deadlineIso).toBe("2026-07-25T19:00:00.000Z");
    expect(item.actions[0]).toMatchObject({ label: "Confirm reservation" });
    expect(item.technical?.workType).toBe("reservation");
  });

  it("projects a double-booking as a high-risk, irreversible exception", () => {
    const item = bookingToAttentionItem(
      { ...bookingRow, overlapQuarantinedAt: new Date("2026-07-24T10:00:00.000Z") },
      NOW,
    );
    expect(item.title).toBe("Resolve Tom Ford's double-booked reservation");
    expect(item.context).toContain("Double-booked");
    expect(item.riskClass).toBe("high-risk");
    expect(item.triage.irreversible).toBe(true);
    expect(item.actions[0]).toMatchObject({ label: "Resolve double-booking" });
    expect(item.technical?.workType).toBe("reservation-exception");
  });

  it("degrades gracefully when the table/service or time is unknown", () => {
    const item = bookingToAttentionItem(
      { ...bookingRow, provider: null, scheduledAt: null, customerName: null },
      NOW,
    );
    expect(item.context).toContain("Table service");
    expect(item.context).toContain("time not set");
    expect(item.context).toContain("tom"); // email local-part fallback
    expect(item.triage.timeToAct).toBe("none");
  });
});

describe("loadStorefrontDemandItems", () => {
  it("loads only actionable demand and projects one item per record", async () => {
    const db = {
      storefrontInquiry: {
        findMany: async () => [inquiryRow],
      },
      storefrontBooking: {
        findMany: async () => [
          bookingRow,
          {
            ...bookingRow,
            id: "bk_2",
            bookingRef: "RES-9",
            status: "confirmed",
            overlapQuarantinedAt: new Date("2026-07-24T10:00:00.000Z"),
          },
        ],
      },
    };

    const items = await loadStorefrontDemandItems(db as never);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.source === "storefront-demand")).toBe(true);
    expect(items.filter((i) => i.id.startsWith("storefront-demand:booking:"))).toHaveLength(2);
  });
});
