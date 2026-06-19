import { describe, it, expect } from "vitest";
import {
  analyzeReadability,
  countSyllables,
  parseReadabilityPolicy,
  resolveReadingLevel,
  withinReadingLevel,
  asReadingLevel,
  readingLevelDirective,
  DEFAULT_READABILITY_POLICY,
} from "./readability";

describe("analyzeReadability", () => {
  it("scores plain copy lower than dense copy", () => {
    const plain = analyzeReadability("The team fixed the leak. We sent a bill. They were happy.");
    const dense = analyzeReadability(
      "Notwithstanding the aforementioned considerations, the organisation's representatives subsequently determined that comprehensive remediation necessitated additional appropriations.",
    );
    expect(plain.gradeLevel).toBeLessThan(dense.gradeLevel);
    expect(plain.readingEase).toBeGreaterThan(dense.readingEase);
    expect(plain.gradeLevel).toBeLessThan(6);
  });

  it("never throws and returns finite numbers on empty input", () => {
    const s = analyzeReadability("   ");
    expect(Number.isFinite(s.gradeLevel)).toBe(true);
    expect(Number.isFinite(s.readingEase)).toBe(true);
    expect(s.words).toBeGreaterThanOrEqual(1);
  });

  it("strips HTML before scoring", () => {
    const withTags = analyzeReadability("<p>The cat sat on the mat.</p>");
    const plain = analyzeReadability("The cat sat on the mat.");
    expect(withTags.gradeLevel).toBeCloseTo(plain.gradeLevel, 5);
  });
});

describe("countSyllables", () => {
  it("counts common words", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("a")).toBe(1);
    expect(countSyllables("running")).toBe(2);
    expect(countSyllables("")).toBe(0);
  });
});

describe("parseReadabilityPolicy", () => {
  it("accepts a valid object", () => {
    const p = parseReadabilityPolicy({ marketing: "college", reseller: "college", architecture: "uncapped" });
    expect(p.marketing).toBe("college");
  });
  it("parses a JSON string", () => {
    const p = parseReadabilityPolicy('{"marketing":"high-school","reseller":"college","architecture":"uncapped"}');
    expect(p).toEqual(DEFAULT_READABILITY_POLICY);
  });
  it("fills defaults for a partial object", () => {
    const p = parseReadabilityPolicy({ marketing: "college" });
    expect(p).toEqual({ marketing: "college", reseller: "college", architecture: "uncapped" });
  });
  it("falls back to the default on garbage", () => {
    expect(parseReadabilityPolicy("not json")).toEqual(DEFAULT_READABILITY_POLICY);
    expect(parseReadabilityPolicy(null)).toEqual(DEFAULT_READABILITY_POLICY);
    expect(parseReadabilityPolicy({ marketing: "phd" })).toEqual(DEFAULT_READABILITY_POLICY);
  });
});

describe("resolveReadingLevel", () => {
  it("returns the policy tier", () => {
    expect(resolveReadingLevel(DEFAULT_READABILITY_POLICY, { audience: "marketing" })).toBe("high-school");
    expect(resolveReadingLevel(DEFAULT_READABILITY_POLICY, { audience: "reseller" })).toBe("college");
    expect(resolveReadingLevel(DEFAULT_READABILITY_POLICY, { audience: "architecture" })).toBe("uncapped");
  });
  it("honours a per-archetype override for marketing only", () => {
    expect(
      resolveReadingLevel(DEFAULT_READABILITY_POLICY, { audience: "marketing", archetypeOverride: "college" }),
    ).toBe("college");
    expect(
      resolveReadingLevel(DEFAULT_READABILITY_POLICY, { audience: "reseller", archetypeOverride: "high-school" }),
    ).toBe("college");
  });
});

describe("withinReadingLevel", () => {
  it("checks the grade against the cap", () => {
    expect(withinReadingLevel(8, "high-school")).toBe(true);
    expect(withinReadingLevel(10, "high-school")).toBe(false);
    expect(withinReadingLevel(13, "college")).toBe(true);
    expect(withinReadingLevel(14, "college")).toBe(false);
    expect(withinReadingLevel(99, "uncapped")).toBe(true);
  });
});

describe("asReadingLevel", () => {
  it("coerces only valid levels", () => {
    expect(asReadingLevel("college")).toBe("college");
    expect(asReadingLevel("phd")).toBeNull();
    expect(asReadingLevel(5)).toBeNull();
  });
});

describe("readingLevelDirective", () => {
  it("names the grade for capped levels and omits for uncapped", () => {
    expect(readingLevelDirective("high-school")).toContain("grade 9");
    expect(readingLevelDirective("college")).toContain("grade 13");
    expect(readingLevelDirective("uncapped")).toBeNull();
  });
});
