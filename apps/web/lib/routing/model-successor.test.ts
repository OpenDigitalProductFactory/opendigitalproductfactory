import { describe, expect, it } from "vitest";

import { resolveModelSuccessor } from "./model-successor";

const codex = (modelId: string, extra: Partial<{ modelFamily: string | null; qualityTier: string; discoveredAt: string }> = {}) => ({
  endpointId: `ep_${modelId}`,
  providerId: "codex",
  modelId,
  modelFamily: extra.modelFamily ?? null,
  qualityTier: extra.qualityTier ?? "frontier",
  discoveredAt: extra.discoveredAt ?? null,
});

describe("resolveModelSuccessor", () => {
  it("prefers the newest eligible model in the same family on the same provider", () => {
    const result = resolveModelSuccessor({
      candidates: [
        codex("gpt-5.4", { modelFamily: "gpt-5", discoveredAt: "2026-05-01T00:00:00Z" }),
        codex("gpt-5.5", { modelFamily: "gpt-5", discoveredAt: "2026-08-01T00:00:00Z" }),
        codex("gpt-6-astra", { modelFamily: "gpt-6", qualityTier: "adequate", discoveredAt: "2026-09-01T00:00:00Z" }),
        { ...codex("claude-opus-4-6"), providerId: "anthropic", modelFamily: "claude-4" },
      ],
      preferredProviderId: "codex",
      preferredModelId: "gpt-5.3-codex",
      preferredModelFamily: "gpt-5",
    });
    expect(result?.basis).toBe("same-family");
    expect(result?.successor.modelId).toBe("gpt-5.5");
  });

  it("falls back to the same provider only when explicitly allowed, by tier then recency then version", () => {
    const candidates = [
      codex("gpt-5.6-luna", { qualityTier: "frontier", discoveredAt: "2026-09-01T00:00:00Z" }),
      codex("gpt-5.6-terra", { qualityTier: "frontier", discoveredAt: "2026-09-01T00:00:00Z" }),
      codex("gpt-6-astra", { qualityTier: "adequate", discoveredAt: "2026-09-10T00:00:00Z" }),
    ];
    // No family match and no permission: a bare provider preference is not a successor.
    expect(resolveModelSuccessor({
      candidates, preferredProviderId: "codex", preferredModelId: "gpt-5.3-codex", preferredModelFamily: "codex",
    })).toBeNull();
    const result = resolveModelSuccessor({
      candidates, preferredProviderId: "codex", preferredModelId: "gpt-5.3-codex", preferredModelFamily: "codex",
      allowProviderFallback: true,
    });
    expect(result?.basis).toBe("same-provider");
    // Both 5.6 models are frontier and equally recent; the higher natural-order id wins.
    expect(result?.successor.modelId).toBe("gpt-5.6-terra");
  });

  it("never crosses providers and never returns the unavailable model itself", () => {
    expect(resolveModelSuccessor({
      candidates: [{ ...codex("claude-opus-4-6"), providerId: "anthropic" }],
      preferredProviderId: "codex",
      preferredModelId: "gpt-5.3-codex",
    })).toBeNull();
    expect(resolveModelSuccessor({
      candidates: [codex("gpt-5.3-codex")],
      preferredProviderId: "codex",
      preferredModelId: "gpt-5.3-codex",
    })).toBeNull();
  });
});
