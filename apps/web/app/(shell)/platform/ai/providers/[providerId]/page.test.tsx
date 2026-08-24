import { describe, expect, it } from "vitest";
import { shouldShowProviderAccountPosture } from "@/components/platform/local-models/provider-detail-policy";

describe("provider detail account posture policy", () => {
  it.each(["local", "ollama"])("omits cloud account and training questions for %s", (providerId) => {
    expect(shouldShowProviderAccountPosture(providerId, "openai-compatible")).toBe(false);
  });

  it("keeps account posture for remote inference providers", () => {
    expect(shouldShowProviderAccountPosture("openai", "openai-compatible")).toBe(true);
  });

  it("keeps service providers on their dedicated detail surface", () => {
    expect(shouldShowProviderAccountPosture("github", "service")).toBe(false);
  });
});
