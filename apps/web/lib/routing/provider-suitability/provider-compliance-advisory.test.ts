import { describe, expect, it } from "vitest";
import {
  formatProviderComplianceAdvisoryForOwner,
  parseProviderComplianceAdvisory,
} from "./provider-compliance-advisory";

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
    expect(message).toContain("What we still need to verify");
    expect(message).toContain("Provider enterprise privacy terms");
    expect(message).toContain("This is decision support, not legal advice");
    expect(message).not.toContain("providerApproved");
  });
});
