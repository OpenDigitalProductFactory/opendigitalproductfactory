import { describe, it, expect } from "vitest";

import { deriveExcellenceCorpus, excellenceCorpusToMarkdown } from "./excellence-corpus";

describe("deriveExcellenceCorpus", () => {
  it("uses the authored flavor note for a flagship archetype", () => {
    const c = deriveExcellenceCorpus({ archetypeId: "dental-practice", industry: "healthcare-wellness" });
    expect(c.whatGreatLooksLike.length).toBeGreaterThan(0);
    expect(c.whatGreatLooksLike).not.toMatch(/A well-run one keeps demand/); // not the generic fallback
    expect(c.northStarKpis.length).toBeGreaterThan(0);
    expect(c.goodOperatorMoves.length).toBeGreaterThan(0);
    expect(c.primaryGoal.length).toBeGreaterThan(0);
  });

  it("returns category good-operator moves for the category", () => {
    const c = deriveExcellenceCorpus({ archetypeId: "some-clinic", industry: "healthcare-wellness" });
    expect(c.goodOperatorMoves.some((m) => /same-day|rebook/i.test(m))).toBe(true);
  });

  it("falls back to generic content when nothing is known", () => {
    const c = deriveExcellenceCorpus({ archetypeId: null, industry: null });
    expect(c.whatGreatLooksLike).toMatch(/well-run/);
    expect(c.goodOperatorMoves.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const a = deriveExcellenceCorpus({ archetypeId: "restaurant", industry: "food-hospitality" });
    const b = deriveExcellenceCorpus({ archetypeId: "restaurant", industry: "food-hospitality" });
    expect(a).toEqual(b);
  });
});

describe("excellenceCorpusToMarkdown", () => {
  it("renders a well-formed WWWD priming page", () => {
    const md = excellenceCorpusToMarkdown(
      deriveExcellenceCorpus({ archetypeId: "restaurant", industry: "food-hospitality" }),
      "Demo Bistro",
    );
    expect(md).toContain("# What great looks like");
    expect(md).toContain("## North-star metrics");
    expect(md).toContain("## What a good operator does");
    expect(md).toContain("Demo Bistro");
  });
});
