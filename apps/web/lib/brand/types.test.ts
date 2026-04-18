import { describe, it, expect } from "vitest";
import { isBrandDesignSystem, type BrandDesignSystem } from "./types";

const minimalValid: BrandDesignSystem = {
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
    primary: "#000000",
    secondary: null,
    accents: [],
    semantic: { success: "#10b981", warning: "#f59e0b", danger: "#ef4444", info: "#3b82f6" },
    neutrals: { 50: "#fff", 100: "#f9f9f9", 200: "#eee", 300: "#ddd", 400: "#bbb", 500: "#888", 600: "#666", 700: "#444", 800: "#222", 900: "#111", 950: "#000" },
    surfaces: { background: "#fff", foreground: "#000", muted: "#f5f5f5", card: "#fff", border: "#e5e5e5" },
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
  confidence: { overall: 0.5, perField: {} },
  gaps: [],
  overrides: {},
};

describe("isBrandDesignSystem", () => {
  it("accepts a minimal valid BrandDesignSystem", () => {
    expect(isBrandDesignSystem(minimalValid)).toBe(true);
  });

  it("rejects null and primitives", () => {
    expect(isBrandDesignSystem(null)).toBe(false);
    expect(isBrandDesignSystem(undefined)).toBe(false);
    expect(isBrandDesignSystem("string")).toBe(false);
    expect(isBrandDesignSystem(42)).toBe(false);
  });

  it("rejects objects missing required fields", () => {
    const { identity: _identity, ...missingIdentity } = minimalValid;
    expect(isBrandDesignSystem(missingIdentity)).toBe(false);
  });

  it("rejects wrong version", () => {
    expect(isBrandDesignSystem({ ...minimalValid, version: "2.0.0" })).toBe(false);
  });
});
