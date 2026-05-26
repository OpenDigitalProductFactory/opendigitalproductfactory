import { describe, expect, it } from "vitest";
import {
  buildAcquisitionSignalWorkspace,
  formatAcquisitionSourceLabel,
  type AcquisitionSignalInput,
} from "./acquisition-signals";

const now = new Date("2026-05-26T12:00:00.000Z");

describe("acquisition signal workspace", () => {
  it("normalizes routable storefront inquiries and preserves source evidence", () => {
    const workspace = buildAcquisitionSignalWorkspace({
      now,
      signals: [
        {
          kind: "storefront_inquiry",
          id: "inq-1",
          source: "web_inquiry",
          sourceRefId: "inq-1",
          observedAt: new Date("2026-05-26T10:30:00.000Z"),
          title: "Website inquiry from Bea Buyer",
          summary: "Can you help with managed IT onboarding?",
          buyerLabel: "Bea Buyer",
          channelLabel: "Storefront inquiry",
          evidence: ["Ref INQ-1001", "bea@example.com"],
          contact: {
            id: "contact-1",
            accountId: "acct-1",
            label: "Bea Buyer",
            email: "bea@example.com",
          },
        },
      ],
    });

    expect(workspace.summary).toEqual({
      observedCount: 1,
      routeReadyCount: 1,
      linkedCount: 0,
      needsContactCount: 0,
    });
    expect(workspace.signals[0]).toMatchObject({
      source: "web_inquiry",
      sourceRefId: "inq-1",
      routingState: "route_ready",
      routingLabel: "Ready to create engagement",
      routeAction: {
        contactId: "contact-1",
        accountId: "acct-1",
        source: "web_inquiry",
        sourceRefId: "inq-1",
      },
    });
    expect(workspace.signals[0]?.evidence).toContain("Ref INQ-1001");
  });

  it("marks duplicate source evidence as already linked", () => {
    const workspace = buildAcquisitionSignalWorkspace({
      now,
      signals: [
        {
          kind: "storefront_inquiry",
          id: "inq-1",
          source: "web_inquiry",
          sourceRefId: "inq-1",
          observedAt: new Date("2026-05-26T10:30:00.000Z"),
          title: "Website inquiry from Bea Buyer",
          summary: "Can you help with managed IT onboarding?",
          buyerLabel: "Bea Buyer",
          channelLabel: "Storefront inquiry",
          evidence: ["Ref INQ-1001"],
          contact: {
            id: "contact-1",
            accountId: "acct-1",
            label: "Bea Buyer",
            email: "bea@example.com",
          },
          linkedEngagement: {
            id: "eng-1",
            title: "Website inquiry from Bea Buyer",
            status: "new",
          },
        },
      ],
    });

    expect(workspace.summary.linkedCount).toBe(1);
    expect(workspace.signals[0]).toMatchObject({
      routingState: "linked",
      routingLabel: "Engagement exists",
      linkedEngagement: {
        id: "eng-1",
        statusLabel: "New",
      },
      routeAction: null,
    });
  });

  it("shows native integration signals as observed when contact evidence is not present", () => {
    const signal: AcquisitionSignalInput = {
      kind: "facebook_lead_ads",
      id: "facebook-lead-ads:page-123",
      source: "facebook_lead_ads",
      sourceRefId: "page-123",
      observedAt: new Date("2026-05-26T09:00:00.000Z"),
      title: "Facebook Lead Ads connected for Acme Local",
      summary: "Recent lead-form preview is available for review.",
      buyerLabel: "Acme Local",
      channelLabel: "Facebook Lead Ads",
      evidence: ["Page page-123", "Last tested 26 May 2026"],
      integrationHref: "/platform/tools/integrations/facebook-lead-ads",
    };

    const workspace = buildAcquisitionSignalWorkspace({ now, signals: [signal] });

    expect(workspace.summary).toEqual({
      observedCount: 1,
      routeReadyCount: 0,
      linkedCount: 0,
      needsContactCount: 1,
    });
    expect(workspace.signals[0]).toMatchObject({
      routingState: "needs_contact",
      routingLabel: "Needs contact",
      routeAction: null,
      integrationHref: "/platform/tools/integrations/facebook-lead-ads",
    });
    expect(workspace.signals[0]?.aiTopics.map((topic) => topic.id)).toEqual([
      "signal-summary",
      "campaign-brief",
    ]);
  });

  it("formats acquisition source labels consistently", () => {
    expect(formatAcquisitionSourceLabel("web_inquiry")).toBe("Storefront inquiry");
    expect(formatAcquisitionSourceLabel("facebook_lead_ads")).toBe("Facebook Lead Ads");
    expect(formatAcquisitionSourceLabel("unknown_source")).toBe("Unknown source");
  });
});
