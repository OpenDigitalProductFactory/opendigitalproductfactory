import { describe, expect, it } from "vitest";

import {
  buildRequirementsPacket,
  formatBuildRequirementsPacketForPrompt,
} from "./build-requirements";

describe("buildRequirementsPacket", () => {
  it("detects payment/cardholder data work and returns a bounded PCI requirements packet", () => {
    const packet = buildRequirementsPacket({
      title: "Credit card checkout",
      brief: {
        description: "Add a customer checkout form that accepts credit cards and stores payment status.",
        dataNeeds: "payment intent, card token, transaction audit log",
        acceptanceCriteria: ["Customers can pay invoices by card."],
      },
    });

    expect(packet.triggeredFamilies).toContain("payment-cardholder-data");
    expect(packet.requiredCoworkerOffers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ offerKey: "aggregate-payment-compliance-requirements" }),
      ]),
    );
    expect(packet.controls).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Do not store raw PAN"),
        expect.stringContaining("PCI DSS"),
      ]),
    );
    expect(packet.prohibitedPatterns).toEqual(expect.arrayContaining([expect.stringContaining("raw card")]));
    expect(packet.contextPolicy).toContain("bounded requirements packet");
  });

  it("detects ADP and D&B style paid provider dependencies with cost and contract requirements", () => {
    const packet = buildRequirementsPacket({
      title: "Supplier and payroll authority sync",
      brief: {
        description: "Use D&B Direct+ for company name authority and ADP for payroll salary payment status.",
        dataNeeds: "DUNS number, company hierarchy, employee payroll status",
        acceptanceCriteria: ["Supplier names are normalized.", "Payroll status syncs nightly."],
      },
      buildPlan: {
        tasks: [
          {
            title: "Integrate providers",
            implement: "Acquire API tokens for D&B Direct+ and ADP before wiring the sync jobs.",
          },
        ],
      },
    });

    expect(packet.triggeredFamilies).toEqual(
      expect.arrayContaining(["company-identity-data-authority", "payroll-workforce-compensation", "paid-provider"]),
    );
    expect(packet.requiredCoworkerOffers.map((offer) => offer.offerKey)).toEqual(
      expect.arrayContaining([
        "aggregate-company-data-authority-requirements",
        "aggregate-payroll-provider-requirements",
        "aggregate-paid-provider-approval-requirements",
      ]),
    );
    expect(packet.providerRequirements).toEqual(expect.arrayContaining([expect.stringContaining("contract")]));
    expect(packet.costTracking).toEqual(expect.arrayContaining([expect.stringContaining("budget owner")]));
  });

  it("returns no packet when the build has no regulated or provider trigger", () => {
    const packet = buildRequirementsPacket({
      title: "Fix dashboard spacing",
      brief: {
        description: "Adjust padding in the internal dashboard header.",
        dataNeeds: "No new data.",
        acceptanceCriteria: ["Header no longer overlaps content."],
      },
    });

    expect(packet.triggeredFamilies).toEqual([]);
    expect(packet.requiredCoworkerOffers).toEqual([]);
    expect(formatBuildRequirementsPacketForPrompt(packet)).toBe("");
  });
});
