import { describe, it, expect } from "vitest";
import {
  reservationExceptionToAttentionItem,
  type ReservationExceptionRow,
} from "./reservation-exception";
import type { AttentionItem } from "../types";
import { portfolioOf } from "../outside-in";
import { classifyOwnerAttentionLane } from "../owner-routing";
import { buildOwnerAttentionProjection } from "../owner-projection";

// A public restaurant booking intake state — the fixture that stands in for a real
// StorefrontBooking without touching a database or taking any external action.
const NOW = new Date("2026-07-22T12:00:00.000Z").getTime();
const pendingBooking: ReservationExceptionRow = {
  bookingId: "bk-1",
  bookingRef: "BK-0001",
  customerName: "Jane Smith",
  itemName: "Table for 2",
  scheduledAt: new Date("2026-07-22T22:30:00.000Z"), // 6:30 PM America/New_York, 10.5h out
  covers: 2,
  status: "pending",
  overlapQuarantinedAt: null,
  createdAt: new Date("2026-07-22T09:00:00.000Z"),
  timezone: "America/New_York",
};

describe("reservationExceptionToAttentionItem", () => {
  it("projects a pending booking as a customer-facing reservation task", () => {
    const item = reservationExceptionToAttentionItem(pendingBooking, NOW);
    expect(item.id).toBe("reservation-exception:BK-0001");
    expect(item.source).toBe("reservation-exception");
    expect(item.title).toBe("Confirm Jane Smith, Table for 2 at 6:30 PM");
    expect(item.context).toContain("Table for 2");
    expect(item.context).toContain("2 guests");
    expect(item.riskClass).toBe("bounded-write");
    expect(item.triage.residueReason).toBe("input-required");
    expect(item.triage.timeToAct).toBe("due-today"); // 10.5h away
    expect(item.triage.blastRadius).toBe("Jane Smith, Table for 2 at 6:30 PM");
    // Customer-facing revenue portfolio — the OUTSIDE-IN separation from coworker cards.
    expect(portfolioOf(item)).toBe("products-and-services-sold");
    expect(item.deepLink).toBe("/storefront/inbox");
    // Read-only deep-link action only — never a destructive confirm/cancel from here.
    expect(item.actions.every((a) => a.kind === "open-in-context")).toBe(true);
  });

  it("escalates an overlap-quarantined booking to a high-risk double-booking", () => {
    const item = reservationExceptionToAttentionItem(
      { ...pendingBooking, overlapQuarantinedAt: new Date("2026-07-22T10:00:00.000Z") },
      NOW,
    );
    expect(item.title).toBe("Resolve double-booking: Jane Smith");
    expect(item.riskClass).toBe("high-risk");
    expect(item.triage.timeToAct).toBe("due-today");
    expect(item.triage.blastRadius).toBe("two reservations that overlap");
  });

  it("routes a reservation exception to needs-you-now, never a batched digest", () => {
    const item = reservationExceptionToAttentionItem(pendingBooking, NOW);
    // Even in assertive mode (which batches reversible reviews), a waiting guest is hard-floored.
    const lane = classifyOwnerAttentionLane(item, "assertive");
    expect(lane.lane).toBe("needs-you-now");
    expect(lane.hardFloor).toBe(true);
  });
});

describe("workspace surfaces reservation exceptions separately from coworker decisions", () => {
  // A generic enterprise-architecture coworker decision card — the kind of item the
  // BI reports as dominating /workspace/inbox. Built as a plain projection literal so
  // this smoke test stays free of the Prisma-client-backed ai-decision loader.
  const eaCard: AttentionItem = {
    id: "ai-decision:DI-1",
    source: "ai-decision",
    title: "Which enterprise-architecture approach fits this migration?",
    context: "Confidence below threshold.",
    decisionClass: { scorability: "unscorable" },
    riskClass: "high-risk",
    triage: {
      timeToAct: "none",
      residueReason: "high-risk-gate",
      blastRadius: "build FB-3",
      decideEffort: "judgment",
      irreversible: false,
    },
    createdAtIso: "2026-07-22T08:00:00.000Z",
    actions: [{ kind: "open-in-context", label: "Review evidence", href: "/platform/ai/decisions/DI-1" }],
    deepLink: "/platform/ai/decisions/DI-1",
    audience: { operator: true },
  };

  it("places the reservation ahead of, and in a different portfolio from, the EA decision card", () => {
    const reservation = reservationExceptionToAttentionItem(pendingBooking, NOW);

    // They are classified into distinct portfolios — the "separately" requirement.
    expect(portfolioOf(reservation)).toBe("products-and-services-sold");
    expect(portfolioOf(eaCard)).toBe("for-employees");

    const projection = buildOwnerAttentionProjection([eaCard, reservation], { nowMs: NOW });
    const ids = projection.needsYouNow.map((e) => e.item.id);
    expect(ids).toContain("reservation-exception:BK-0001");
    expect(ids).toContain("ai-decision:DI-1");
    // Outside-in: the customer-facing reservation outranks the inner coworker card.
    expect(ids.indexOf("reservation-exception:BK-0001")).toBeLessThan(ids.indexOf("ai-decision:DI-1"));
  });
});
