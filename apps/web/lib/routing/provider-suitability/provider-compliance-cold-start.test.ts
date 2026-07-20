import { describe, expect, it } from "vitest";
import {
  buildDeterministicProviderComplianceFallback,
  resolveProviderComplianceColdStartReply,
} from "./provider-compliance-cold-start";
import {
  buildProviderReviewPacket,
  formatProviderReviewObjective,
} from "./provider-review-packet";

const packet = buildProviderReviewPacket({
  businessProfile: {
    organizationId: "org-1",
    archetypeId: "arch-software",
    archetypeCategory: "software",
    operatesIn: ["eu"],
    sellsTo: ["eu"],
    employsIn: [],
    dataResidency: ["eu"],
    riskPosture: "conservative",
  },
  recommendation: {
    status: "review-needed",
    workloadClasses: ["customer-records", "public-marketing"],
    items: [{
      providerConnectionId: "conn-1",
      providerId: "openai",
      scope: "public-only",
    }],
  },
});
const chatHistory = [{ role: "user", content: formatProviderReviewObjective(packet) }];

describe("provider compliance cold start", () => {
  it("produces a cited non-approval without a model", () => {
    const advisory = buildDeterministicProviderComplianceFallback(packet);
    expect(advisory.decision).toBe("insufficient-evidence");
    expect(advisory.humanReviewRequired).toBe(true);
    expect(advisory.workloadRestrictions).toContain(
      "Keep customer records on a governed non-egress path until the connected account is evidenced.",
    );
    expect(advisory.citations[0]?.reference).toBe(
      "professions/legal-compliance/ai-provider-account-and-sovereignty-review",
    );
  });

  it("keeps a bounded conditional local answer", () => {
    const reply = resolveProviderComplianceColdStartReply({
      chatHistory,
      specialistReply: JSON.stringify({
        schemaVersion: "provider-compliance-advisory.v1",
        decision: "conditional",
        plainLanguageSummary: "Use only after account-scoped terms are verified.",
        safestNextAction: "Obtain the signed processor terms.",
        workloadRestrictions: ["Keep customer records local."],
        unknowns: ["Regional entitlement is not proven."],
        humanReviewRequired: true,
        citations: [{
          title: "Account review rule",
          reference: "professions/legal-compliance/ai-provider-account-and-sovereignty-review",
          supports: "Account evidence is required.",
        }],
      }),
    });
    expect(reply.resultSource).toBe("local-model");
    expect(reply.advisory.decision).toBe("conditional");
  });

  it("replaces a hosted-provider approval with deterministic non-approval", () => {
    const reply = resolveProviderComplianceColdStartReply({
      chatHistory,
      specialistReply: JSON.stringify({
        schemaVersion: "provider-compliance-advisory.v1",
        decision: "recommended",
        plainLanguageSummary: "The provider is approved.",
        safestNextAction: "Activate it.",
        workloadRestrictions: [],
        unknowns: [],
        humanReviewRequired: false,
        citations: [{ title: "Marketing page", reference: "provider.example", supports: "Provider says it is private." }],
      }),
    });
    expect(reply.resultSource).toBe("deterministic-fallback");
    expect(reply.advisory.decision).toBe("insufficient-evidence");
    expect(reply.content).not.toContain("Activate it");
  });
});
