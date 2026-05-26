import { describe, expect, it } from "vitest";
import {
  CRM_TONE_CLASSES,
  formatCrmStatusLabel,
  getAccountStatusMeta,
  getEngagementStatusMeta,
  getOpportunityStageMeta,
  getQuoteStatusMeta,
  getSalesOrderStatusMeta,
  isOpenOpportunityStage,
  OPEN_OPPORTUNITY_STAGES,
} from "./presentation";

describe("CRM presentation metadata", () => {
  it("defines open opportunity stages in buyer-progress order", () => {
    expect(OPEN_OPPORTUNITY_STAGES).toEqual([
      "qualification",
      "discovery",
      "proposal",
      "negotiation",
    ]);
  });

  it("identifies only active pipeline stages as open", () => {
    expect(isOpenOpportunityStage("qualification")).toBe(true);
    expect(isOpenOpportunityStage("closed_won")).toBe(false);
    expect(isOpenOpportunityStage("unknown")).toBe(false);
  });

  it("formats CRM status values for display", () => {
    expect(formatCrmStatusLabel("closed_won")).toBe("Closed won");
    expect(formatCrmStatusLabel("in_progress")).toBe("In progress");
    expect(formatCrmStatusLabel("new")).toBe("New");
  });

  it("returns specific metadata for known statuses and fallback metadata otherwise", () => {
    expect(getAccountStatusMeta("active")).toMatchObject({
      label: "Active",
      tone: "success",
    });
    expect(getEngagementStatusMeta("converted")).toMatchObject({
      label: "Converted",
      tone: "accent",
    });
    expect(getOpportunityStageMeta("proposal")).toMatchObject({
      label: "Proposal",
      tone: "info",
    });
    expect(getOpportunityStageMeta("custom_stage")).toMatchObject({
      label: "Custom stage",
      tone: "neutral",
    });
  });

  it("returns quote status metadata for quote list and opportunity detail badges", () => {
    expect(getQuoteStatusMeta("sent")).toMatchObject({
      label: "Sent",
      tone: "info",
    });
    expect(getQuoteStatusMeta("accepted")).toMatchObject({
      label: "Accepted",
      tone: "success",
    });
    expect(getQuoteStatusMeta("rejected")).toMatchObject({
      label: "Rejected",
      tone: "danger",
    });
    expect(getQuoteStatusMeta("custom_quote_state")).toMatchObject({
      label: "Custom quote state",
      tone: "neutral",
    });
  });

  it("returns sales order status metadata for order badges", () => {
    expect(getSalesOrderStatusMeta("confirmed")).toMatchObject({
      label: "Confirmed",
      tone: "info",
    });
    expect(getSalesOrderStatusMeta("in_progress")).toMatchObject({
      label: "In progress",
      tone: "warning",
    });
    expect(getSalesOrderStatusMeta("fulfilled")).toMatchObject({
      label: "Fulfilled",
      tone: "success",
    });
    expect(getSalesOrderStatusMeta("unknown_order_state")).toMatchObject({
      label: "Unknown order state",
      tone: "neutral",
    });
  });

  it("uses theme-aware classes instead of raw hex colors", () => {
    const serialized = JSON.stringify(CRM_TONE_CLASSES);
    expect(serialized).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(serialized).toContain("var(--dpf-");
  });
});
