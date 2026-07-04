import { describe, it, expect } from "vitest";

import {
  buildCraftOverrideSlug,
  validateCraftOverride,
  CRAFT_OVERRIDE_SLUG_PREFIX,
} from "./craft-override";

describe("buildCraftOverrideSlug", () => {
  it("namespaces the slug by profession then title", () => {
    expect(
      buildCraftOverrideSlug("data-architect", "Always partition by tenant"),
    ).toBe("craft/data-architect/always-partition-by-tenant");
  });

  it("slugifies both segments and strips punctuation", () => {
    expect(buildCraftOverrideSlug("Finance ", "Close by day 5!!")).toBe(
      "craft/finance/close-by-day-5",
    );
  });

  it("falls back for empty inputs", () => {
    expect(buildCraftOverrideSlug("", "")).toBe(
      `${CRAFT_OVERRIDE_SLUG_PREFIX}/unscoped/untitled`,
    );
  });
});

describe("validateCraftOverride", () => {
  it("accepts a well-formed override and normalizes", () => {
    const result = validateCraftOverride({
      professionKey: "data-architect",
      title: "  Partition by tenant  ",
      body: "  We always partition large tables by tenant id.  ",
      summary: "  tenant partitioning  ",
    });
    expect(result).toEqual({
      ok: true,
      slug: "craft/data-architect/partition-by-tenant",
      professionKey: "data-architect",
      title: "Partition by tenant",
      body: "We always partition large tables by tenant id.",
      summary: "tenant partitioning",
    });
  });

  it("requires a profession", () => {
    const result = validateCraftOverride({
      professionKey: "",
      title: "Some rule",
      body: "a body long enough to pass",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/profession/i);
  });

  it("rejects a too-short body", () => {
    const result = validateCraftOverride({
      professionKey: "finance",
      title: "Close discipline",
      body: "no",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sentence/i);
  });
});
