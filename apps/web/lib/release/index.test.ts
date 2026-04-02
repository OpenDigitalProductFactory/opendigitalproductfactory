import { describe, expect, it } from "vitest";

describe("release barrel export", () => {
  // storefront-actions requires "use server" + prisma; tested in storefront-actions.test.ts
  // storefront-data requires prisma + react cache; tested in storefront-data.test.ts
  // Full barrel import chains into next-auth env; individual modules tested separately.

  it("exports branding-presets", async () => {
    const mod = await import("./branding-presets");
    expect(mod).toHaveProperty("deriveThemeTokens");
    expect(mod).toHaveProperty("OOTB_PRESETS");
  });

  it("exports storefront-auth", async () => {
    const mod = await import("./storefront-auth");
    expect(mod).toHaveProperty("detectEmailType");
  });

  it("exports storefront-middleware", async () => {
    const mod = await import("./storefront-middleware");
    expect(mod).toHaveProperty("classifyRoute");
  });
});
