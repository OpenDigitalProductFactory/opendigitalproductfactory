import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BrandDesignSystem } from "../types";

const mocks = vi.hoisted(() => ({
  callWithFailover: vi.fn(),
}));

vi.mock("@/lib/inference/ai-provider-priority", () => ({
  callWithFailover: mocks.callWithFailover,
}));

import { synthesize } from "./synthesize";

function systemWithGaps(gaps: string[]): BrandDesignSystem {
  return {
    version: "1.0.0",
    extractedAt: "2026-04-18T00:00:00.000Z",
    sources: [],
    identity: {
      name: "Acme",
      tagline: null,
      description: null,
      logo: { darkBg: null, lightBg: null, mark: null },
      voice: { tone: "neutral", sampleCopy: [] },
    },
    palette: {
      primary: "#336699",
      secondary: null,
      accents: [],
      semantic: { success: "#10b981", warning: "#f59e0b", danger: "#ef4444", info: "#3b82f6" },
      neutrals: {
        50: "#ffffff", 100: "#f9f9f9", 200: "#eeeeee", 300: "#dddddd", 400: "#bbbbbb",
        500: "#888888", 600: "#666666", 700: "#444444", 800: "#222222", 900: "#111111", 950: "#000000",
      },
      surfaces: {
        background: "#ffffff",
        foreground: "#000000",
        muted: "#f5f5f5",
        card: "#ffffff",
        border: "#e5e5e5",
      },
    },
    typography: {
      families: { sans: "Inter", serif: null, mono: "JetBrains Mono", display: null },
      scale: {
        xs: { size: "0.75rem", lineHeight: "1rem", tracking: "0", weight: 400 },
        sm: { size: "0.875rem", lineHeight: "1.25rem", tracking: "0", weight: 400 },
        base: { size: "1rem", lineHeight: "1.5rem", tracking: "0", weight: 400 },
        lg: { size: "1.125rem", lineHeight: "1.75rem", tracking: "0", weight: 400 },
        xl: { size: "1.25rem", lineHeight: "1.75rem", tracking: "0", weight: 500 },
        "2xl": { size: "1.5rem", lineHeight: "2rem", tracking: "0", weight: 600 },
        "3xl": { size: "1.875rem", lineHeight: "2.25rem", tracking: "0", weight: 700 },
        "4xl": { size: "2.25rem", lineHeight: "2.5rem", tracking: "0", weight: 700 },
        "5xl": { size: "3rem", lineHeight: "1", tracking: "0", weight: 700 },
        "6xl": { size: "3.75rem", lineHeight: "1", tracking: "0", weight: 700 },
      },
      pairings: [],
    },
    components: { library: "shadcn", inventory: [], patterns: [] },
    tokens: { radii: {}, spacing: {}, shadows: {}, motion: {}, breakpoints: {} },
    confidence: { overall: 0.6, perField: { "palette.primary": 0.8, "identity.name": 0.7 } },
    gaps,
    overrides: {},
  };
}

describe("synthesize", () => {
  beforeEach(() => {
    mocks.callWithFailover.mockReset();
  });

  it("returns the merged system unchanged when there are no gaps", async () => {
    const input = systemWithGaps([]);
    const result = await synthesize(input);

    expect(result).toBe(input);
    expect(mocks.callWithFailover).not.toHaveBeenCalled();
  });

  it("calls the AI provider when gaps are present and populates fields", async () => {
    mocks.callWithFailover.mockResolvedValue({
      result: {
        content: JSON.stringify({
          identity: { tagline: "We make widgets", description: "Acme makes widgets for builders." },
          palette: { secondary: "#ff8800" },
        }),
        inputTokens: 100,
        outputTokens: 50,
        inferenceMs: 2000,
      },
    });

    const input = systemWithGaps(["identity-no-tagline", "palette-no-secondary"]);
    const result = await synthesize(input);

    expect(mocks.callWithFailover).toHaveBeenCalledOnce();
    expect(result.identity.tagline).toBe("We make widgets");
    expect(result.palette.secondary).toBe("#ff8800");
    expect(result.confidence.perField["identity.tagline"]).toBeLessThanOrEqual(0.5);
    expect(result.confidence.perField["palette.secondary"]).toBeLessThanOrEqual(0.5);
    expect(result.gaps).toEqual([]);
  });

  it("leaves gaps unchanged if the AI response is malformed JSON", async () => {
    mocks.callWithFailover.mockResolvedValue({
      result: {
        content: "not-valid-json",
        inputTokens: 100,
        outputTokens: 10,
        inferenceMs: 500,
      },
    });

    const input = systemWithGaps(["identity-no-tagline"]);
    const result = await synthesize(input);

    expect(result.gaps).toContain("identity-no-tagline");
    expect(result.gaps).toContain("synthesizer-invalid-json");
  });

  it("survives AI provider errors and returns input with a gap", async () => {
    mocks.callWithFailover.mockRejectedValue(new Error("rate limited"));

    const input = systemWithGaps(["identity-no-tagline"]);
    const result = await synthesize(input);

    expect(result.identity.tagline).toBeNull();
    expect(result.gaps).toContain("synthesizer-failed");
  });
});
