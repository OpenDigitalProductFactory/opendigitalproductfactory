import { describe, expect, it } from "vitest";

import {
  PROVIDER_COMPLIANCE_SOURCE_REGISTRY,
  validateProviderComplianceSourceRegistry,
} from "./provider-compliance-source-registry";

describe("provider compliance source registry", () => {
  it("contains unique, dated, authoritative claim ids with explicit applicability", () => {
    expect(validateProviderComplianceSourceRegistry(PROVIDER_COMPLIANCE_SOURCE_REGISTRY)).toEqual([]);
  });

  it("keeps provider claims scoped to the named service and account class", () => {
    const openai = PROVIDER_COMPLIANCE_SOURCE_REGISTRY["openai/business-data-privacy"];
    expect(openai.publisher).toBe("OpenAI");
    expect(openai.claims[0]?.appliesTo).toMatchObject({
      providerIds: ["openai"],
      services: expect.arrayContaining(["api-platform"]),
      accountClasses: expect.arrayContaining(["business-team"]),
    });
    expect(openai.claims[0]?.appliesTo.accountClasses).not.toContain("personal");
  });

  it("uses the current Anthropic commercial training article", () => {
    expect(PROVIDER_COMPLIANCE_SOURCE_REGISTRY["anthropic/commercial-training"].url).toContain(
      "/7996885-how-do-you-use-personal-data-in-model-training",
    );
  });
});
