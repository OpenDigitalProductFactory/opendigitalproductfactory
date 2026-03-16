import { describe, expect, it } from "vitest";
import { deriveThemeTokens, OOTB_PRESETS } from "./branding-presets";

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
