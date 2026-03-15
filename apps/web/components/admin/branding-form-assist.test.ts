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
});
