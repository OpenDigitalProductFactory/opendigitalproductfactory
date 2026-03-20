import { describe, expect, it } from "vitest";
import {
  deriveThemeTokens,
  deriveLightTokens,
  OOTB_PRESETS,
  contrastRatio,
  hexToHsl,
  hslToHex,
} from "./branding-presets";

describe("deriveThemeTokens", () => {
  it("generates dual token sets from an accent color", () => {
    const tokens = deriveThemeTokens("#2563eb");
    expect(tokens.dark.version).toBe("1.0.0");
    expect(tokens.dark.palette.accent).toBe("#2563eb");
    expect(tokens.dark.palette.bg).toBeTruthy();
    expect(tokens.light.palette.bg).toBe("#fafafa");
  });

  it("accepts optional font override", () => {
    const tokens = deriveThemeTokens("#2563eb", { fontFamily: "Roboto" });
    expect(tokens.dark.typography.fontFamily).toBe("Roboto");
    expect(tokens.light.typography.fontFamily).toBe("Roboto");
  });

  it("produces valid hex colors for all dark palette entries", () => {
    const { dark } = deriveThemeTokens("#d97706");
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    expect(dark.palette.bg).toMatch(hexRe);
    expect(dark.palette.surface1).toMatch(hexRe);
    expect(dark.palette.surface2).toMatch(hexRe);
    expect(dark.palette.accent).toMatch(hexRe);
    expect(dark.palette.muted).toMatch(hexRe);
    expect(dark.palette.border).toMatch(hexRe);
    expect(dark.palette.text).toMatch(hexRe);
  });
});

describe("OOTB_PRESETS", () => {
  it("has 6 generic presets", () => {
    expect(OOTB_PRESETS).toHaveLength(6);
  });

  it("each preset has required fields with dual tokens", () => {
    for (const preset of OOTB_PRESETS) {
      expect(preset.scope).toMatch(/^theme-preset:/);
      expect(preset.companyName).toBeTruthy();
      expect(preset.logoUrl).toBe("/logos/open-digital-product-factory-logo.svg");
      expect(preset.tokens.dark.palette.accent).toBeTruthy();
      expect(preset.tokens.light.palette.accent).toBeTruthy();
    }
  });
});

describe("deriveThemeTokens (dual)", () => {
  it("returns an object with dark and light keys", () => {
    const tokens = deriveThemeTokens("#2563eb");
    expect(tokens).toHaveProperty("dark");
    expect(tokens).toHaveProperty("light");
  });

  it("dark palette has dark background, light text", () => {
    const { dark } = deriveThemeTokens("#2563eb");
    const bgHsl = hexToHsl(dark.palette.bg);
    expect(bgHsl.l).toBeLessThan(20);
    expect(dark.palette.text).toBe("#e2e2f0");
  });

  it("light palette has light background, dark text", () => {
    const { light } = deriveThemeTokens("#2563eb");
    expect(light.palette.bg).toBe("#fafafa");
    expect(light.palette.surface1).toBe("#ffffff");
    expect(light.palette.text).toBe("#1a1a2e");
  });

  it("light palette shadows have lower opacity than dark", () => {
    const { dark, light } = deriveThemeTokens("#2563eb");
    const getOpacity = (s: string) => parseFloat(s.match(/[\d.]+\)$/)?.[0] ?? "0");
    expect(getOpacity(light.shadows.panel)).toBeLessThan(getOpacity(dark.shadows.panel));
  });

  it("preserves accent hue between modes", () => {
    const { dark, light } = deriveThemeTokens("#2563eb");
    const darkHsl = hexToHsl(dark.palette.accent);
    const lightHsl = hexToHsl(light.palette.accent);
    expect(Math.abs(darkHsl.h - lightHsl.h)).toBeLessThan(5);
  });

  it("all 6 OOTB presets produce valid dual tokens", () => {
    for (const preset of OOTB_PRESETS) {
      expect(preset.tokens).toHaveProperty("dark");
      expect(preset.tokens).toHaveProperty("light");
      const { dark, light } = preset.tokens;
      expect(dark.palette.bg).toBeTruthy();
      expect(light.palette.bg).toBe("#fafafa");
    }
  });
});

describe("deriveLightTokens", () => {
  it("is exported and callable", () => {
    const light = deriveLightTokens("#2563eb");
    expect(light.version).toBe("1.0.0");
    expect(light.palette.bg).toBe("#fafafa");
  });

  it("produces valid hex colors for all palette entries", () => {
    const light = deriveLightTokens("#d97706");
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    expect(light.palette.bg).toMatch(hexRe);
    expect(light.palette.surface1).toMatch(hexRe);
    expect(light.palette.surface2).toMatch(hexRe);
    expect(light.palette.accent).toMatch(hexRe);
    expect(light.palette.muted).toMatch(hexRe);
    expect(light.palette.border).toMatch(hexRe);
    expect(light.palette.text).toMatch(hexRe);
  });

  it("uses darker state colors suitable for light backgrounds", () => {
    const light = deriveLightTokens("#2563eb");
    expect(light.states.success).toBe("#16a34a");
    expect(light.states.warning).toBe("#d97706");
    expect(light.states.error).toBe("#dc2626");
    expect(light.states.info).toBe("#2563eb");
  });

  it("accent meets 4.5:1 contrast against light background", () => {
    const light = deriveLightTokens("#2563eb");
    const ratio = contrastRatio(light.palette.accent, light.palette.bg);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("muted meets 4.5:1 contrast against light background", () => {
    const light = deriveLightTokens("#2563eb");
    const ratio = contrastRatio(light.palette.muted, light.palette.bg);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
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
