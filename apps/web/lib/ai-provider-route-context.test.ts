import { describe, expect, it } from "vitest";
import {
  applyProviderRouteModelPreference,
  inferProviderIdFromRouteContext,
} from "./ai-provider-route-context";

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
});
