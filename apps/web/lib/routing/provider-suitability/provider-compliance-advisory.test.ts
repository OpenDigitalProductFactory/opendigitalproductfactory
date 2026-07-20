import { describe, expect, it } from "vitest";
import {
  formatProviderComplianceAdvisoryForOwner,
  parseProviderComplianceAdvisory,
  validateProviderComplianceAdvisoryGrounding,
} from "./provider-compliance-advisory";
import { buildProviderReviewPacket } from "./provider-review-packet";

const advisory = {
  schemaVersion: "provider-compliance-advisory.v1",
  decision: "conditional",
  plainLanguageSummary: "Use this provider only after the business account and EU processing terms are verified.",
  safestNextAction: "Ask the provider for the signed business terms and documented processing region.",
  workloadRestrictions: ["Do not send customer records until the review is complete."],
  unknowns: ["The connected account's retention terms are not evidenced."],
  humanReviewRequired: true,
  citations: [
    {
      title: "Provider enterprise privacy terms",
      reference: "https://provider.example/business-privacy",
      supports: "Business terms control training and retention treatment.",
    },
  ],
};

describe("provider compliance advisory", () => {
  it("parses the exact bounded contract from a specialist response", () => {
    expect(parseProviderComplianceAdvisory(JSON.stringify(advisory))).toEqual({
      success: true,
      value: advisory,
    });
  });

  it("extracts a fenced JSON object but rejects prose-only, unknown fields, and missing citations", () => {
    expect(parseProviderComplianceAdvisory(`Evidence follows:\n\`\`\`json\n${JSON.stringify(advisory)}\n\`\`\``)).toEqual({
      success: true,
      value: advisory,
    });
    expect(parseProviderComplianceAdvisory("Probably fine.")).toEqual({
      success: false,
      error: "advisory_invalid:json",
    });
    expect(parseProviderComplianceAdvisory(JSON.stringify({ ...advisory, providerApproved: true }))).toEqual({
      success: false,
      error: "advisory_unknown_field:providerApproved",
    });
    expect(parseProviderComplianceAdvisory(JSON.stringify({ ...advisory, citations: [] }))).toEqual({
      success: false,
      error: "advisory_invalid:citations",
    });
  });

  it("formats a concise COO answer with substantiation and explicit unknowns", () => {
    const message = formatProviderComplianceAdvisoryForOwner(advisory as never);

    expect(message).toContain("My recommendation: conditional");
    expect(message).toMatch(/^Only if/);
    expect(message).toContain("What we still need to verify");
    expect(message).toContain("Provider enterprise privacy terms");
    expect(message).toContain("This is decision support, not legal advice");
    expect(message).not.toContain("providerApproved");
  });

  it.each([
    ["recommended", "Yes."],
    ["conditional", "Only if"],
    ["not-suitable", "No."],
    ["insufficient-evidence", "Cannot confirm"],
  ])("starts the %s owner answer with the direct-answer contract", (decision, prefix) => {
    const message = formatProviderComplianceAdvisoryForOwner({ ...advisory, decision } as never);
    expect(message.startsWith(prefix)).toBe(true);
  });

  it("accepts only a current canonical claim applicable to the minimized company packet", () => {
    const packet = buildProviderReviewPacket({
      businessProfile: {
        organizationId: "org-1",
        archetypeId: null,
        archetypeCategory: null,
        operatesIn: ["eu"],
        sellsTo: [],
        employsIn: [],
        dataResidency: ["eu"],
        riskPosture: "conservative",
      },
      recommendation: {
        status: "review-needed",
        workloadClasses: ["customer-records"],
        items: [{ providerConnectionId: "conn-1", providerId: "openai", scope: "public-only" }],
      },
    });
    const grounded = {
      ...advisory,
      citations: [{
        title: "GDPR Article 28",
        reference: "eu/gdpr-controller-processor-and-transfers",
        sourceClaimId: "eu-controller-processor-contract-required",
        supports: "A processor contract is required.",
      }],
    };

    expect(validateProviderComplianceAdvisoryGrounding(grounded as never, packet, new Date("2026-07-20"))).toEqual({
      success: true,
      errors: [],
    });
    expect(validateProviderComplianceAdvisoryGrounding({
      ...grounded,
      citations: [{ ...grounded.citations[0], sourceClaimId: "invented-claim" }],
    } as never, packet, new Date("2026-07-20"))).toMatchObject({ success: false });
  });

  it("uses the exact connection channel and account class for provider-term claims", () => {
    const packet = buildProviderReviewPacket({
      businessProfile: {
        organizationId: "org-1",
        archetypeId: null,
        archetypeCategory: null,
        operatesIn: ["eu"],
        sellsTo: [],
        employsIn: [],
        dataResidency: ["eu"],
        riskPosture: "conservative",
      },
      recommendation: {
        status: "review-needed",
        workloadClasses: ["customer-records"],
        items: [{
          providerConnectionId: "conn-1",
          providerId: "openai",
          scope: "public-only",
          executionChannel: "direct-api",
          accountClass: "business-team",
        }],
      },
    });
    const providerClaim = {
      ...advisory,
      citations: [{
        title: "OpenAI business data",
        reference: "openai/business-data-privacy",
        sourceClaimId: "openai-business-no-training-default",
        supports: "API inputs and outputs are not used for training by default.",
      }],
    };

    expect(validateProviderComplianceAdvisoryGrounding(providerClaim as never, packet, new Date("2026-07-20"))).toMatchObject({ success: true });
    const personalPacket = {
      ...packet,
      providerConnections: packet.providerConnections.map((connection) => ({
        ...connection,
        executionChannel: "subscription-cli",
        accountClass: "regular",
      })),
    };
    expect(validateProviderComplianceAdvisoryGrounding(providerClaim as never, personalPacket, new Date("2026-07-20"))).toMatchObject({ success: false });
  });
});
