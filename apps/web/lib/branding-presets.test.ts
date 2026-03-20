import { describe, expect, it } from "vitest";
import {
  deriveThemeTokens,
  OOTB_PRESETS,
  contrastRatio,
  hexToHsl,
  hslToHex,
} from "./branding-presets";

describe("deriveThemeTokens", () => {
  it("generates a full token set from an accent color", () => {
    const tokens = deriveThemeTokens("#2563eb");
    expect(tokens.version).toBe("1.0.0");
    expect(tokens.palette.accent).toBe("#2563eb");
    expect(tokens.palette.bg).toBeTruthy();
    expect(tokens.palette.surface1).toBeTruthy();
    expect(tokens.palette.surface2).toBeTruthy();
    expect(tokens.palette.muted).toBeTruthy();
    expect(tokens.palette.border).toBeTruthy();
    expect(tokens.typography.fontFamily).toBeTruthy();
    expect(tokens.typography.headingFontFamily).toBeTruthy();
  });

  it("accepts optional font override", () => {
    const tokens = deriveThemeTokens("#2563eb", { fontFamily: "Roboto" });
    expect(tokens.typography.fontFamily).toBe("Roboto");
  });

  it("produces valid hex colors for all palette entries", () => {
    const tokens = deriveThemeTokens("#d97706");
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    expect(tokens.palette.bg).toMatch(hexRe);
    expect(tokens.palette.surface1).toMatch(hexRe);
    expect(tokens.palette.surface2).toMatch(hexRe);
    expect(tokens.palette.accent).toMatch(hexRe);
    expect(tokens.palette.muted).toMatch(hexRe);
    expect(tokens.palette.border).toMatch(hexRe);
  });
});

describe("OOTB_PRESETS", () => {
  it("has 6 generic presets", () => {
    expect(OOTB_PRESETS).toHaveLength(6);
  });

  it("each preset has required fields", () => {
    for (const preset of OOTB_PRESETS) {
      expect(preset.scope).toMatch(/^theme-preset:/);
      expect(preset.companyName).toBeTruthy();
      expect(preset.logoUrl).toBe("/logos/open-digital-product-factory-logo.svg");
      expect(preset.tokens.palette.accent).toBeTruthy();
    }
  });
});

describe("contrastRatio", () => {
  it("returns 21 for black on white", () => {
    const ratio = contrastRatio("#000000", "#ffffff");
    expect(ratio).toBeCloseTo(21, 0);
  });

  it("returns 1 for white on white", () => {
    const ratio = contrastRatio("#ffffff", "#ffffff");
    expect(ratio).toBeCloseTo(1, 1);
  });

  it("returns correct ratio for known pair", () => {
    // #767676 on white = ~4.54:1 (WCAG AA threshold)
    const ratio = contrastRatio("#767676", "#ffffff");
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe("hexToHsl / hslToHex", () => {
  it("round-trips pure red", () => {
    const hsl = hexToHsl("#ff0000");
    expect(hsl.h).toBeCloseTo(0, 0);
    expect(hsl.s).toBeCloseTo(100, 0);
    expect(hsl.l).toBeCloseTo(50, 0);
    expect(hslToHex(hsl.h, hsl.s, hsl.l)).toBe("#ff0000");
  });

  it("round-trips a mid-tone blue within 1 channel tolerance", () => {
    const hex = "#2563eb";
    const hsl = hexToHsl(hex);
    const result = hslToHex(hsl.h, hsl.s, hsl.l);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
    const [r1, g1, b1] = [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
    const [r2, g2, b2] = [parseInt(result.slice(1,3),16), parseInt(result.slice(3,5),16), parseInt(result.slice(5,7),16)];
    expect(Math.abs(r1 - r2)).toBeLessThanOrEqual(1);
    expect(Math.abs(g1 - g2)).toBeLessThanOrEqual(1);
    expect(Math.abs(b1 - b2)).toBeLessThanOrEqual(1);
  });
});
