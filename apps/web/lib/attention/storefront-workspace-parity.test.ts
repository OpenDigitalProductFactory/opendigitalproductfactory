// Smoke coverage that the four surfaces agree on restaurant demand (BI-348766E5):
//   /storefront        — the owner dashboard's actionable customer-record counts
//   /storefront/inbox  — the owner list of those records
//   /workspace         — the OperatorCockpit "what needs you now" surface
//   /workspace/inbox   — the full owner attention queue
//
// All four read the SAME StorefrontInquiry / StorefrontBooking truth. This test drives
// ONE fake DB state through the real storefront-demand loader (what the storefront
// surfaces expose) and the real attention aggregate + owner projection (what the
// workspace surfaces render), and asserts they cannot disagree: the workspace cannot
// say "Nothing needs you right now" while unhandled customer records exist, the count
// matches the storefront's, and concrete restaurant work sorts ahead of generic
// fallback decisions.

import { describe, expect, it } from "vitest";

import { loadAttentionItems, filterAttentionForAudience } from "./aggregate";
import { buildOwnerAttentionProjection } from "./owner-projection";
import {
  inquiryToAttentionItem,
  loadStorefrontDemandItems,
} from "./sources/storefront-demand";
import type { AttentionItem } from "./types";

const NOW_MS = Date.UTC(2026, 6, 24, 12, 0, 0);

// Every model resolves to an empty read by default; only the storefront tables carry
// state. Loaders that read a non-injected substrate simply degrade to failedSources —
// the aggregate is resilient by design — so the storefront demand still flows through.
function fakeDb(overrides: Record<string, unknown>) {
  const emptyModel = {
    findMany: async () => [],
    findFirst: async () => null,
    count: async () => 0,
  };
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop in overrides) return overrides[prop as keyof typeof overrides];
        return emptyModel;
      },
    },
  );
}

const inquiries = [
  {
    id: "inq_1",
    inquiryRef: "ENQ-1",
    customerName: "Emma Blake",
    customerEmail: "emma@example.com",
    message: "Party of 8?",
    status: "new",
    createdAt: new Date("2026-07-24T09:30:00.000Z"),
  },
  {
    id: "inq_2",
    inquiryRef: "ENQ-2",
    customerName: null,
    customerEmail: "guest@example.com",
    message: "Do you do gluten-free?",
    status: "new",
    createdAt: new Date("2026-07-24T10:00:00.000Z"),
  },
  // Already handled — must NOT surface on any of the four routes.
  {
    id: "inq_3",
    inquiryRef: "ENQ-3",
    customerName: "Old Lead",
    customerEmail: "old@example.com",
    message: "n/a",
    status: "responded",
    createdAt: new Date("2026-07-01T10:00:00.000Z"),
  },
];

const bookings = [
  {
    id: "bk_1",
    bookingRef: "RES-1",
    customerName: "Tom Ford",
    customerEmail: "tom@example.com",
    scheduledAt: new Date("2026-07-25T19:00:00.000Z"),
    status: "pending",
    overlapQuarantinedAt: null,
    createdAt: new Date("2026-07-24T08:00:00.000Z"),
    provider: { name: "Window table 4" },
  },
  {
    id: "bk_2",
    bookingRef: "RES-2",
    customerName: "Ada Reed",
    customerEmail: "ada@example.com",
    scheduledAt: new Date("2026-07-24T13:00:00.000Z"),
    status: "confirmed",
    overlapQuarantinedAt: new Date("2026-07-24T10:00:00.000Z"), // double-booked review queue
    createdAt: new Date("2026-07-23T08:00:00.000Z"),
    provider: { name: "Booth 2" },
  },
];

function makeDb() {
  return fakeDb({
    storefrontInquiry: { findMany: async () => inquiries },
    storefrontBooking: { findMany: async () => bookings },
  });
}

// The count the storefront surfaces expose (dashboard counts + inbox list, actionable
// subset): 2 open inquiries + 2 pending/quarantined reservations.
const EXPECTED_ACTIONABLE = 4;

describe("storefront ↔ workspace demand parity", () => {
  it("/storefront + /storefront/inbox expose exactly the actionable customer records", async () => {
    const demand = await loadStorefrontDemandItems(makeDb() as never);
    expect(demand).toHaveLength(EXPECTED_ACTIONABLE);
    expect(demand.every((i) => i.source === "storefront-demand")).toBe(true);
    // The handled inquiry is excluded from all surfaces.
    expect(demand.some((i) => i.id.includes("inq_3"))).toBe(false);
  });

  it("/workspace + /workspace/inbox surface the same demand and cannot read 'nothing needs you'", async () => {
    const { items } = await loadAttentionItems(makeDb() as never);
    const visible = filterAttentionForAudience(items, { operator: true });
    const projection = buildOwnerAttentionProjection(visible, {
      fallbackLevel: "balanced",
      nowMs: NOW_MS,
    });

    // The guardrail: unhandled customer records force a non-zero owner count.
    expect(projection.count).toBe(EXPECTED_ACTIONABLE);
    expect(projection.needsYouNow.length).toBe(EXPECTED_ACTIONABLE);
    // Parity with the storefront side — same truth, same number.
    const storefrontCount = (await loadStorefrontDemandItems(makeDb() as never)).length;
    expect(projection.count).toBe(storefrontCount);
    // Every projected demand card is a storefront-demand item.
    expect(
      projection.needsYouNow.every((e) => e.item.source === "storefront-demand"),
    ).toBe(true);
  });

  it("groups concrete restaurant work ahead of generic fallback decisions", () => {
    const restaurant = inquiries
      .filter((i) => i.status === "new")
      .map((i) => inquiryToAttentionItem(i));
    // A generic, judgment-class residue decision (the "review this decision" fallback).
    const generic: AttentionItem = {
      id: "ai-decision:DI-9",
      source: "ai-decision",
      title: "Approve migration approach?",
      context: "The governed scopes could not resolve this decision.",
      decisionClass: { scorability: "unscorable" },
      riskClass: "bounded-write",
      triage: {
        timeToAct: "none",
        residueReason: "coverage-gap",
        decideEffort: "judgment",
        irreversible: false,
      },
      createdAtIso: "2026-07-20T12:00:00.000Z",
      actions: [],
      deepLink: "/platform/ai/decisions/DI-9",
      audience: { operator: true },
    };

    const projection = buildOwnerAttentionProjection([generic, ...restaurant], {
      fallbackLevel: "balanced",
      nowMs: NOW_MS,
    });
    const sources = projection.needsYouNow.map((e) => e.item.source);
    // Restaurant (products & services sold) sorts before the for-employees fallback.
    const firstGeneric = sources.indexOf("ai-decision");
    const lastStorefront = sources.lastIndexOf("storefront-demand");
    expect(lastStorefront).toBeLessThan(firstGeneric);
  });

  it("each restaurant card carries guest/ref, table/service, date/time, status and one action", async () => {
    const { items } = await loadAttentionItems(makeDb() as never);
    const projection = buildOwnerAttentionProjection(
      filterAttentionForAudience(items, { operator: true }),
      { fallbackLevel: "balanced", nowMs: NOW_MS },
    );

    const reservation = projection.needsYouNow.find((e) =>
      e.item.id.startsWith("storefront-demand:booking:bk_1"),
    );
    expect(reservation).toBeDefined();
    if (!reservation) throw new Error("expected the pending reservation card");
    const { card } = reservation;
    expect(card.headline).toContain("Tom Ford"); // guest
    expect(card.situation).toContain("RES-1"); // ref
    expect(card.situation).toContain("Window table 4"); // table/service
    expect(card.situation).toContain("Sat 25 Jul 19:00"); // date/time
    expect(card.situation).toContain("Awaiting confirmation"); // status
    expect(card.choices).toHaveLength(1); // one exact next action
    expect(card.choices[0].label).toBe("Confirm reservation");
  });
});
