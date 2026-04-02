import { describe, expect, it } from "vitest";

describe("govern barrel export", () => {
  it("exports password utilities", async () => {
    const mod = await import("./password");
    expect(mod).toHaveProperty("hashPassword");
    expect(mod).toHaveProperty("verifyPassword");
  });

  it("exports compliance types", async () => {
    const mod = await import("./compliance-types");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it("exports policy types", async () => {
    const mod = await import("./policy-types");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
