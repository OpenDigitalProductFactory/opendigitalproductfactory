import { describe, it, expect } from "vitest";
import { merge } from "./merge";
import type { PartialDesignSystem } from "./types";

function palette(primary: string): NonNullable<PartialDesignSystem["palette"]> {
  return {
    primary,
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
  };
}

describe("merge", () => {
  it("codebase wins over url for palette.primary", () => {
    const fromCodebase: PartialDesignSystem = {
      sources: [{ kind: "codebase", ref: "/app", capturedAt: "t" }],
      palette: palette("#111111"),
      confidence: { overall: 0.6, perField: { "palette.primary": 0.8 } },
    };
    const fromUrl: PartialDesignSystem = {
      sources: [{ kind: "url", ref: "https://example.com", capturedAt: "t" }],
      palette: palette("#222222"),
      confidence: { overall: 0.6, perField: { "palette.primary": 0.7 } },
    };

    const result = merge([fromCodebase, fromUrl]);

    expect(result.palette.primary).toBe("#111111");
    expect(result.confidence.perField["palette.primary"]).toBeGreaterThanOrEqual(0.6);
  });

  it("boosts confidence when two sources agree on the same value", () => {
    const fromCodebase: PartialDesignSystem = {
      sources: [{ kind: "codebase", ref: "/app", capturedAt: "t" }],
      palette: palette("#336699"),
      confidence: { overall: 0.6, perField: { "palette.primary": 0.8 } },
    };
    const fromUrl: PartialDesignSystem = {
      sources: [{ kind: "url", ref: "https://example.com", capturedAt: "t" }],
      palette: palette("#336699"),
      confidence: { overall: 0.6, perField: { "palette.primary": 0.7 } },
    };

    const result = merge([fromCodebase, fromUrl]);

    expect(result.palette.primary).toBe("#336699");
    expect(result.confidence.perField["palette.primary"]).toBeGreaterThanOrEqual(0.9);
  });

  it("uploads win over url and codebase for identity.logo.mark", () => {
    const fromUpload: PartialDesignSystem = {
      sources: [{ kind: "upload", ref: "logo.png", capturedAt: "t" }],
      identity: {
        name: "",
        tagline: null,
        description: null,
        logo: {
          darkBg: null,
          lightBg: null,
          mark: { url: "data:image/png;base64,abc", source: "upload", mimeType: "image/png" },
        },
        voice: { tone: "neutral", sampleCopy: [] },
      },
      confidence: { overall: 0.5, perField: { "identity.logo.mark": 0.9 } },
    };
    const fromUrl: PartialDesignSystem = {
      sources: [{ kind: "url", ref: "https://example.com", capturedAt: "t" }],
      identity: {
        name: "Acme",
        tagline: null,
        description: null,
        logo: {
          darkBg: null,
          lightBg: null,
          mark: { url: "https://example.com/logo.png", source: "scraped" },
        },
        voice: { tone: "neutral", sampleCopy: [] },
      },
      confidence: { overall: 0.5, perField: { "identity.name": 0.7, "identity.logo.mark": 0.7 } },
    };

    const result = merge([fromUrl, fromUpload]);

    expect(result.identity.logo.mark?.url).toContain("data:image/png");
    expect(result.identity.name).toBe("Acme");
  });

  it("when only one source supplies a value, confidence stays at its level", () => {
    const only: PartialDesignSystem = {
      sources: [{ kind: "url", ref: "https://example.com", capturedAt: "t" }],
      palette: palette("#abcdef"),
      confidence: { overall: 0.4, perField: { "palette.primary": 0.4 } },
    };

    const result = merge([only]);

    expect(result.palette.primary).toBe("#abcdef");
    expect(result.confidence.perField["palette.primary"]).toBe(0.4);
  });

  it("collects sources and gaps across all partials", () => {
    const a: PartialDesignSystem = {
      sources: [{ kind: "codebase", ref: "/app", capturedAt: "t1" }],
      gaps: ["no-font-family"],
      confidence: { overall: 0.5, perField: {} },
    };
    const b: PartialDesignSystem = {
      sources: [{ kind: "url", ref: "https://example.com", capturedAt: "t2" }],
      gaps: ["url-no-palette"],
      confidence: { overall: 0.3, perField: {} },
    };

    const result = merge([a, b]);

    expect(result.sources).toHaveLength(2);
    expect(result.gaps).toContain("no-font-family");
    expect(result.gaps).toContain("url-no-palette");
  });

  it("produces a valid minimal BrandDesignSystem when given no partials", () => {
    const result = merge([]);

    expect(result.version).toBe("1.0.0");
    expect(result.sources).toEqual([]);
    expect(result.confidence.overall).toBe(0);
    expect(result.gaps.length).toBeGreaterThan(0);
  });
});
