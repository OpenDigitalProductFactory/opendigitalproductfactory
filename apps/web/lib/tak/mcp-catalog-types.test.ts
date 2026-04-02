import { describe, expect, it } from "vitest";
import { deriveArchetypeIds, ARCHETYPE_TAG_RULESET } from "./mcp-catalog-types";

describe("deriveArchetypeIds", () => {
  it("returns matching archetype IDs for known tags", () => {
    const result = deriveArchetypeIds(["payments", "ecommerce"]);
    expect(result).toContain("retail-goods");
    expect(result).toContain("food-hospitality");
  });

  it("deduplicates when multiple tags map to the same archetype", () => {
    const result = deriveArchetypeIds(["payments", "ecommerce"]);
    const unique = new Set(result);
    expect(unique.size).toBe(result.length);
  });

  it("returns empty array for unknown tags", () => {
    expect(deriveArchetypeIds(["unknowntag123"])).toEqual([]);
  });

  it("is case-insensitive for tags", () => {
    const lower = deriveArchetypeIds(["payments"]);
    const upper = deriveArchetypeIds(["PAYMENTS"]);
    expect(lower).toEqual(upper);
  });

  it("handles empty tags array", () => {
    expect(deriveArchetypeIds([])).toEqual([]);
  });

  it("analytics tag returns all archetypes defined in ARCHETYPE_TAG_RULESET", () => {
    // "analytics" must map to every archetype that appears anywhere in the ruleset
    const allArchetypes = new Set(Object.values(ARCHETYPE_TAG_RULESET).flat());
    const result = deriveArchetypeIds(["analytics"]);
    for (const archetype of allArchetypes) {
      expect(result).toContain(archetype);
    }
  });
});
