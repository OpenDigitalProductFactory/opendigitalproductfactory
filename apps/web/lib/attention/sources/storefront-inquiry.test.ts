import { describe, it, expect } from "vitest";
import {
  storefrontInquiryToAttentionItem,
  inquiryBacklogItemId,
  type StorefrontInquiryRow,
} from "./storefront-inquiry";
import { portfolioOf } from "../outside-in";
import { classifyOwnerAttentionLane } from "../owner-routing";
import { specialistFor } from "../owner-decision-copy";

// A public restaurant enquiry intake state — stands in for a real StorefrontInquiry
// without touching a database or taking any external action (BI-A36CF68D).
const newInquiry: StorefrontInquiryRow = {
  inquiryId: "inq-1",
  inquiryRef: "INQ-FGQXCF4X",
  customerName: "UX Study Guest",
  customerEmail: "ux-study@example.invalid",
  message: "Do you take private-dining bookings for twelve people?",
  itemName: null,
  createdAt: new Date("2026-07-22T09:00:00.000Z"),
};

describe("storefrontInquiryToAttentionItem", () => {
  it("projects a new enquiry as a customer-facing reply task", () => {
    const item = storefrontInquiryToAttentionItem(newInquiry);
    expect(item.id).toBe("storefront-inquiry:INQ-FGQXCF4X");
    expect(item.source).toBe("storefront-inquiry");
    expect(item.title).toBe("Reply to UX Study Guest");
    expect(item.context).toContain("private-dining");
    expect(item.triage.residueReason).toBe("input-required");
    expect(item.triage.blastRadius).toContain("INQ-FGQXCF4X");
    // Customer-facing revenue portfolio — the OUTSIDE-IN separation from coworker cards,
    // same lane as reservation exceptions.
    expect(portfolioOf(item)).toBe("products-and-services-sold");
    expect(item.deepLink).toBe("/storefront/inbox");
    // Read-only deep-link action only — replying happens in the inbox, not from here.
    expect(item.actions.every((a) => a.kind === "open-in-context")).toBe(true);
  });

  it("names the linked item when the enquiry is about a specific offer", () => {
    const item = storefrontInquiryToAttentionItem({ ...newInquiry, itemName: "Private Dining" });
    expect(item.title).toBe("Reply to UX Study Guest about Private Dining");
  });

  it("falls back to ref + email context when the enquiry has no message", () => {
    const item = storefrontInquiryToAttentionItem({ ...newInquiry, message: null });
    expect(item.context).toContain("INQ-FGQXCF4X");
    expect(item.context).toContain("ux-study@example.invalid");
  });

  it("routes a waiting customer to needs-you-now, never a batched digest", () => {
    const item = storefrontInquiryToAttentionItem(newInquiry);
    // Even in assertive mode (which batches reversible reviews), a waiting lead is hard-floored.
    const lane = classifyOwnerAttentionLane(item, "assertive");
    expect(lane.lane).toBe("needs-you-now");
    expect(lane.hardFloor).toBe(true);
  });

  it("belongs to the front-of-house specialist like reservations", () => {
    expect(specialistFor("storefront-inquiry")).toBe("Front of house");
  });
});

describe("inquiryBacklogItemId", () => {
  it("derives the same settled-marker id that Send-to-backlog creates", () => {
    // Mirrors the inbox page + product-backlog route derivation: an inquiry with
    // this backlog item present has been routed and must NOT surface as attention.
    expect(inquiryBacklogItemId("INQ-FGQXCF4X")).toBe("BI-SFI-INQFGQXCF4X");
  });
});
