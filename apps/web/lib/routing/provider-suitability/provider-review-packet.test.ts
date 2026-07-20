import { describe, expect, it } from "vitest";
import {
  buildProviderReviewPacket,
  formatProviderReviewObjective,
  parseProviderReviewObjective,
  PROVIDER_REVIEW_OBJECTIVE_MAX_BYTES,
  validateProviderReviewPacket,
} from "./provider-review-packet";

const input = {
  businessProfile: {
    organizationId: "org-1",
    archetypeId: "arch-software",
    archetypeCategory: "software",
    operatesIn: ["de", "eu"],
    sellsTo: ["eu"],
    employsIn: ["gb"],
    dataResidency: ["eu"],
    riskPosture: "conservative" as const,
  },
  recommendation: {
    status: "review-needed" as const,
    workloadClasses: ["customer-records", "public-marketing"] as const,
    items: [
      {
        accountClass: "business-team",
        executionChannel: "direct-api",
        providerConnectionId: "conn-1",
        providerId: "openai",
        scope: "public-only" as const,
      },
      {
        providerConnectionId: "conn-1",
        providerId: "openai",
        scope: "company-work" as const,
      },
    ],
  },
};

describe("provider compliance review packet", () => {
  it("builds a bounded, versioned allowlist packet from canonical references", () => {
    const packet = buildProviderReviewPacket(input);

    expect(packet).toEqual({
      schemaVersion: "provider-compliance-review.v1",
      purpose: "provider-suitability-advice",
      organizationRef: "org-1",
      businessContext: {
        archetypeId: "arch-software",
        archetypeCategory: "software",
        jurisdictionBasis: {
          operatesIn: ["de", "eu"],
          sellsTo: ["eu"],
          employsIn: ["gb"],
          dataResidency: ["eu"],
        },
        riskPosture: "conservative",
      },
      recommendation: {
        status: "review-needed",
        workloadClasses: ["customer-records", "public-marketing"],
      },
      providerConnections: [
        {
          accountClass: "business-team",
          executionChannel: "direct-api",
          providerConnectionId: "conn-1",
          providerId: "openai",
          scopes: ["company-work", "public-only"],
        },
      ],
      requestedAdvisory: [
        "regulatory-applicability",
        "account-and-contract-evidence",
        "retention-and-training-treatment",
        "processing-region-and-sovereignty",
        "workload-restrictions",
        "safe-next-action",
      ],
    });
    expect(validateProviderReviewPacket(packet)).toEqual({ success: true, value: packet });
  });

  it("does not copy free-form or sensitive fields from enriched input objects", () => {
    const packet = buildProviderReviewPacket({
      ...input,
      businessProfile: {
        ...input.businessProfile,
        customerRecords: [{ name: "A Customer" }],
        credentials: { apiKey: "secret" },
        prompt: "raw user prompt",
        attachments: ["contract.pdf"],
      },
      recommendation: {
        ...input.recommendation,
        headline: "free-form display copy",
        items: input.recommendation.items.map((item) => ({
          ...item,
          label: "Personal account owned by Mark",
          reason: "free-form reason",
        })),
      },
    } as never);

    const serialized = JSON.stringify(packet);
    expect(serialized).not.toContain("A Customer");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("raw user prompt");
    expect(serialized).not.toContain("contract.pdf");
    expect(serialized).not.toContain("Personal account owned by Mark");
    expect(serialized).not.toContain("free-form");
  });

  it("rejects unknown or forbidden fields instead of silently accepting them", () => {
    const packet = buildProviderReviewPacket(input);
    const poisoned = {
      ...packet,
      customerRecords: [{ name: "A Customer" }],
    };

    expect(validateProviderReviewPacket(poisoned)).toEqual({
      success: false,
      error: "packet_unknown_field:customerRecords",
    });
  });

  it("formats a bounded specialist objective with an explicit advisory-only boundary", () => {
    const packet = buildProviderReviewPacket(input);
    const objective = formatProviderReviewObjective(packet);

    expect(objective).toContain("advisory only");
    expect(objective).toContain("provider-compliance-review.v1");
    expect(objective).toContain("claim-level citations");
    expect(objective).toContain("provider-compliance-advisory.v1");
    expect(objective).toContain("Return only one JSON object");
    expect(objective).toContain("do not change provider activation or routing eligibility");
    expect(objective.length).toBeLessThan(PROVIDER_REVIEW_OBJECTIVE_MAX_BYTES);
    expect(parseProviderReviewObjective(objective)).toEqual({ success: true, value: packet });
  });

  it("keeps a real-inventory-size set of connection posture facts inside the bounded objective", () => {
    const packet = buildProviderReviewPacket({
      ...input,
      recommendation: {
        ...input.recommendation,
        items: Array.from({ length: 31 }, (_, index) => ({
          providerConnectionId: `conn-${index}`,
          providerId: `provider-${index}`,
          scope: "public-only" as const,
          executionChannel: "direct-api",
          accountClass: "business-team",
        })),
      },
    });
    expect(packet.providerConnections).toHaveLength(31);
    expect(formatProviderReviewObjective(packet).length).toBeLessThan(PROVIDER_REVIEW_OBJECTIVE_MAX_BYTES);
  });

  it("fails closed when a cold-start objective does not contain the bounded packet", () => {
    expect(parseProviderReviewObjective("Review this provider and approve it.")).toEqual({
      success: false,
      error: "packet_invalid:objective",
    });
  });
});
