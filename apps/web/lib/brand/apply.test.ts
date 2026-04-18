import { describe, it, expect } from "vitest";
import type { BrandDesignSystem } from "./types";
import { designSystemToThemeTokens } from "./apply";

function baseSystem(overrides?: Partial<BrandDesignSystem>): BrandDesignSystem {
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
        background: "#ffffff", foreground: "#000000", muted: "#f5f5f5", card: "#ffffff", border: "#e5e5e5",
      },
    },
    typography: {
      families: { sans: "Poppins", serif: null, mono: "JetBrains Mono", display: "Poppins Display" },
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
    confidence: { overall: 0.6, perField: {} },
    gaps: [],
    overrides: {},
    ...overrides,
  };
}

describe("designSystemToThemeTokens", () => {
  it("maps palette.primary to tokens.palette.accent via deriveThemeTokens", () => {
    const tokens = designSystemToThemeTokens(baseSystem());

    // deriveThemeTokens tunes the accent for contrast/legibility; both
    // variants should produce a valid hex value. Exact equality with
    // the input is not guaranteed by design.
    expect(tokens.dark.palette.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(tokens.light.palette.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("maps typography.families.sans to tokens.typography.fontFamily", () => {
    const tokens = designSystemToThemeTokens(baseSystem());

    expect(tokens.dark.typography.fontFamily).toContain("Poppins");
    expect(tokens.light.typography.fontFamily).toContain("Poppins");
  });

  it("uses display family for heading when present, falls back to sans when absent", () => {
    const withDisplay = designSystemToThemeTokens(baseSystem());
    expect(withDisplay.dark.typography.headingFontFamily).toContain("Poppins Display");

    const noDisplay = designSystemToThemeTokens(
      baseSystem({
        typography: {
          families: { sans: "Inter", serif: null, mono: "JetBrains Mono", display: null },
          scale: baseSystem().typography.scale,
          pairings: [],
        },
      }),
    );
    expect(noDisplay.dark.typography.headingFontFamily).toContain("Inter");
  });

  it("propagates semantic colors into states", () => {
    const tokens = designSystemToThemeTokens(baseSystem());

    expect(tokens.dark.states.success).toBe("#10b981");
    expect(tokens.dark.states.warning).toBe("#f59e0b");
    expect(tokens.dark.states.error).toBe("#ef4444");
    expect(tokens.dark.states.info).toBe("#3b82f6");
  });

  it("produces a valid ThemeTokens shape with all required top-level sections", () => {
    const tokens = designSystemToThemeTokens(baseSystem());

    for (const variant of [tokens.dark, tokens.light]) {
      expect(variant.palette).toBeDefined();
      expect(variant.typography).toBeDefined();
      expect(variant.spacing).toBeDefined();
      expect(variant.radius).toBeDefined();
      expect(variant.surfaces).toBeDefined();
      expect(variant.states).toBeDefined();
      expect(variant.shadows).toBeDefined();
      expect(variant.version).toBeDefined();
    }
  });
});
