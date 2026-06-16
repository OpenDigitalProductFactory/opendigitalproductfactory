// Invariant: the WSID corpus archetype axis (PROFESSION_ARCHETYPES) stays in
// sync with the canonical install archetype taxonomy (ArchetypeCategory /
// ALL_ARCHETYPES). If a new business archetype is added to the platform but not
// to the corpus axis, an install of that archetype could never be served (or
// tagged with) archetype-specific craft — this fails loudly so the axis grows
// alongside the taxonomy.
import { describe, expect, it } from "vitest";

import { ALL_ARCHETYPES } from "@dpf/storefront-templates";
import { PROFESSION_ARCHETYPES, isProfessionArchetype } from "@dpf/db/wiki-taxonomy";
import { normalizeVariantAxes } from "@/lib/coworker-record/variant-axes";

const canonicalCategories = [...new Set(ALL_ARCHETYPES.map((a) => a.category))];

describe("profession-archetype axis sync", () => {
  it("covers every canonical ArchetypeCategory", () => {
    const corpus = new Set(PROFESSION_ARCHETYPES as readonly string[]);
    const missing = canonicalCategories.filter((c) => !corpus.has(c));
    expect(missing, `categories missing from PROFESSION_ARCHETYPES: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("has no slug beyond `universal` + the canonical categories", () => {
    const allowed = new Set<string>(["universal", ...canonicalCategories]);
    const extra = (PROFESSION_ARCHETYPES as readonly string[]).filter((s) => !allowed.has(s));
    expect(extra, `unknown archetype slugs in PROFESSION_ARCHETYPES: ${extra.join(", ")}`).toHaveLength(0);
  });

  it("includes the `universal` archetype-neutral default", () => {
    expect(isProfessionArchetype("universal")).toBe(true);
    expect(PROFESSION_ARCHETYPES[0]).toBe("universal");
  });
});

describe("normalizeVariantAxes — archetype axis", () => {
  it("defaults a page with no archetype to universal", () => {
    expect(normalizeVariantAxes({}).archetypes).toEqual(["universal"]);
    expect(normalizeVariantAxes(null).archetypes).toEqual(["universal"]);
  });

  it("reads declared archetypes from metadata", () => {
    const axes = normalizeVariantAxes({ professionArchetype: ["automotive-services", "moving-and-logistics"] });
    expect(axes.archetypes).toEqual(["automotive-services", "moving-and-logistics"]);
  });

  it("still returns jurisdiction + level alongside archetype", () => {
    const axes = normalizeVariantAxes({
      professionJurisdiction: ["us"],
      professionCompetencyLevel: "expert",
      professionArchetype: ["banking-financial-services"],
    });
    expect(axes).toEqual({
      jurisdictions: ["us"],
      level: "expert",
      archetypes: ["banking-financial-services"],
    });
  });
});
