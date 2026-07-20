import { describe, expect, it } from "vitest";
import {
  applyProviderSuitabilityRouteContext,
  applyProviderRouteModelPreference,
  inferProviderIdFromRouteContext,
} from "./ai-provider-route-context";
import type { ProviderSuitabilityPolicy } from "./routing/provider-suitability/types";
import { inferContract } from "./routing/request-contract";

function policy(overrides: Partial<ProviderSuitabilityPolicy> = {}): ProviderSuitabilityPolicy {
  return {
    policyId: "aips-test",
    organizationId: "org-1",
    source: "onboarding",
    effect: "allow",
    allowedProviders: ["azure-openai", "local"],
    deniedProviders: ["openai"],
    allowedProviderConnectionIds: ["conn-azure", "conn-local"],
    deniedProviderConnectionIds: ["conn-openai"],
    residencyPolicy: "approved_cloud",
    openRouterObligations: null,
    explanations: [],
    compilerVersion: "1.0.0",
    ...overrides,
  };
}

describe("AI provider route context", () => {
  it("extracts the provider id from provider detail routes", () => {
    expect(inferProviderIdFromRouteContext("/platform/ai/providers/gemini")).toBe("gemini");
    expect(inferProviderIdFromRouteContext("/platform/ai/providers/anthropic-sub?tab=models")).toBe("anthropic-sub");
  });

  it("applies the provider detail route as the preferred provider", () => {
    expect(applyProviderRouteModelPreference({
      defaultMinimumTier: "strong",
      defaultBudgetClass: "balanced",
      preferredProviderId: "anthropic-sub",
      preferredModelId: "claude-haiku-4-5-20251001",
    }, "/platform/ai/providers/gemini")).toEqual({
      defaultMinimumTier: "strong",
      defaultBudgetClass: "balanced",
      preferredProviderId: "gemini",
    });
  });

  it("leaves non-provider routes unchanged", () => {
    expect(applyProviderRouteModelPreference({
      defaultMinimumTier: "strong",
      preferredProviderId: "anthropic-sub",
    }, "/platform/ai")).toEqual({
      defaultMinimumTier: "strong",
      preferredProviderId: "anthropic-sub",
    });
  });

  it("composes provider suitability into inferContract route overrides", () => {
    expect(applyProviderSuitabilityRouteContext({ budgetClass: "quality_first" }, policy())).toEqual({
      budgetClass: "quality_first",
      allowedProviders: ["azure-openai", "local"],
      deniedProviders: ["openai"],
      residencyPolicy: "approved_cloud",
    });
  });

  it("intersects an existing allowlist and unions denials", () => {
    expect(applyProviderSuitabilityRouteContext({
      allowedProviders: ["local", "openai"],
      deniedProviders: ["anthropic"],
      residencyPolicy: "any_enabled",
    }, policy())).toEqual({
      allowedProviders: ["local"],
      deniedProviders: ["anthropic", "openai"],
      residencyPolicy: "approved_cloud",
    });
  });

  it("preserves the stricter local-only residency bound", () => {
    expect(applyProviderSuitabilityRouteContext({ residencyPolicy: "local_only" }, policy()).residencyPolicy)
      .toBe("local_only");
  });

  it("compiles a deny effect to an explicit empty allowlist", () => {
    expect(applyProviderSuitabilityRouteContext({}, policy({ effect: "deny", allowedProviders: [] })))
      .toMatchObject({ allowedProviders: [], deniedProviders: ["openai"] });
  });

  it("feeds the compiled hard bounds into inferContract", async () => {
    const routeContext = applyProviderSuitabilityRouteContext({}, policy());
    const contract = await inferContract(
      "summarization",
      [{ role: "user", content: "Summarize this governed record." }],
      undefined,
      undefined,
      routeContext,
    );
    expect(contract).toMatchObject({
      allowedProviders: ["azure-openai", "local"],
      deniedProviders: ["openai"],
      residencyPolicy: "approved_cloud",
    });
  });
});
