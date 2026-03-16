import { describe, expect, it } from "vitest";
import {
  applyBrandingFormAssistUpdates,
  type BrandingFormState,
} from "./branding-form-assist";

const baseState: BrandingFormState = {
  companyName: "Open Digital Product Factory",
  logoUrl: "/logos/dpf.svg",
  tokens: {
    palette_accent: "#7c8cf8",
    palette_bg: "#080814",
    typography_fontFamily: "Space Grotesk",
  },
};

describe("branding form assist", () => {
  it("applies allowed branding field updates", () => {
    const next = applyBrandingFormAssistUpdates(baseState, {
      companyName: "Jack Jack's Pack",
      logoUrl: "https://jackjackspack.org/logo.svg",
      paletteAccent: "#4f46e5",
    });

    expect(next.companyName).toBe("Jack Jack's Pack");
    expect(next.logoUrl).toBe("https://jackjackspack.org/logo.svg");
    expect(next.tokens.palette_accent).toBe("#4f46e5");
  });

  it("ignores unknown fields", () => {
    const next = applyBrandingFormAssistUpdates(baseState, {
      companyName: "Jack Jack's Pack",
      unknownField: "ignored",
    });

    expect(next.companyName).toBe("Jack Jack's Pack");
    expect("unknownField" in next).toBe(false);
  });

  it("applies surface color updates", () => {
    const next = applyBrandingFormAssistUpdates(baseState, { surfacesSidebar: "#1a1a2e" });
    expect(next.tokens.surfaces_sidebar).toBe("#1a1a2e");
  });

  it("applies state color updates", () => {
    const next = applyBrandingFormAssistUpdates(baseState, { statesSuccess: "#22c55e", statesError: "#ef4444" });
    expect(next.tokens.states_success).toBe("#22c55e");
    expect(next.tokens.states_error).toBe("#ef4444");
  });

  it("applies spacing and radius updates", () => {
    const next = applyBrandingFormAssistUpdates(baseState, { spacingMd: "16px", radiusSm: "4px" });
    expect(next.tokens.spacing_md).toBe("16px");
    expect(next.tokens.radius_sm).toBe("4px");
  });

  it("applies shadow updates", () => {
    const next = applyBrandingFormAssistUpdates(baseState, { shadowsCard: "0 8px 16px rgba(0,0,0,0.3)" });
    expect(next.tokens.shadows_card).toBe("0 8px 16px rgba(0,0,0,0.3)");
  });

  it("applies all palette colors", () => {
    const next = applyBrandingFormAssistUpdates(baseState, {
      paletteSurface1: "#222233", paletteSurface2: "#333344",
      paletteMuted: "#888899", paletteBorder: "#444455",
    });
    expect(next.tokens.palette_surface1).toBe("#222233");
    expect(next.tokens.palette_surface2).toBe("#333344");
    expect(next.tokens.palette_muted).toBe("#888899");
    expect(next.tokens.palette_border).toBe("#444455");
  });
});
