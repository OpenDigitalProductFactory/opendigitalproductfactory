import { describe, expect, it } from "vitest";

describe("release barrel export", () => {
  // Full barrel import chains into next-auth env; individual modules tested separately.
  // The storefront-* modules moved to lib/storefront/ (Simplify & Strengthen W10).

  it("exports branding-presets", async () => {
    const mod = await import("./branding-presets");
    expect(mod).toHaveProperty("deriveThemeTokens");
    expect(mod).toHaveProperty("OOTB_PRESETS");
  });
});
