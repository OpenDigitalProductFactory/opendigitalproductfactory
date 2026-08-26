import { describe, it, expect } from "vitest";
import {
  analyzeReadability,
  analyzeUiReadability,
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

// ── BI-0ED0F6B3 — Flesch–Kincaid over a UI surface ──────────────────────────

/** The /finance/mileage copy that exposed the defect: labels, not prose. */
const UI_LABELS = [
  "Mileage",
  "3 to sort",
  "See my drives",
  "Date",
  "Route",
  "Miles",
  "Sorted",
  "Owed",
  "Business",
  "Personal",
  "Commute",
];

const JARGON =
  "Organizational participation in international infrastructure optimization initiatives necessitates comprehensive administrative documentation.";

describe("analyzeReadability — the prose assumption it rests on", () => {
  it("inflates the grade of unpunctuated UI labels, at unchanged word difficulty", () => {
    const flat = analyzeReadability(UI_LABELS.join(" "));
    const punctuated = analyzeReadability(UI_LABELS.join(". ") + ".");

    // Same words, same syllables per word. The ONLY difference is full stops.
    expect(flat.words).toBe(punctuated.words);
    expect(flat.syllablesPerWord).toBe(punctuated.syllablesPerWord);

    // And yet the grade moves by five, because sentence count went 1 -> 11.
    expect(flat.sentences).toBe(1);
    expect(punctuated.sentences).toBe(11);
    expect(flat.gradeLevel).toBeGreaterThan(punctuated.gradeLevel + 4);
  });
});

describe("analyzeUiReadability — BI-0ED0F6B3 directive 2", () => {
  it("is punctuation-independent BY CONSTRUCTION, not by luck", () => {
    // No sentence-length term exists in the formula, so no arrangement of full
    // stops can move the result. Assert across the whole spectrum of ways a UI
    // could be punctuated, not just one.
    const bare = analyzeUiReadability(UI_LABELS).gradeLevel;
    const perLabel = analyzeUiReadability(UI_LABELS.map((l) => `${l}.`)).gradeLevel;
    const allOne = analyzeUiReadability([UI_LABELS.join(" ")]).gradeLevel;
    const shouty = analyzeUiReadability(UI_LABELS.map((l) => `${l}!?!`)).gradeLevel;
    expect(new Set([bare, perLabel, allOne, shouty]).size).toBe(1);
  });

  it("separates plain product copy from dense operator prose", () => {
    // The two cases the policy exists to tell apart, at IDENTICAL structure.
    const plain = analyzeUiReadability(["Date", "Route", "Miles", "Sorted", "Owed"]);
    const dense = analyzeUiReadability([
      "Infrastructure",
      "Optimization",
      "Administrative",
      "Documentation",
      "Organizational",
    ]);
    expect(withinReadingLevel(plain.gradeLevel, "high-school")).toBe(true);
    expect(withinReadingLevel(dense.gradeLevel, "high-school")).toBe(false);
  });

  it("reads word difficulty on Flesch–Kincaid's own scale", () => {
    // 11.8 * spw - 15.59. The BI's two anchors: 1.76 plain, 3.57 dense.
    const at = (spw: number) => Math.round((11.8 * spw - 15.59) * 10) / 10;
    expect(at(1.76)).toBe(5.2);
    expect(at(3.57)).toBe(26.5);
  });

  it("counts every word once, whatever the utterance split", () => {
    const split = analyzeUiReadability(["Date", "Route", "Miles"]);
    const joined = analyzeUiReadability(["Date Route Miles"]);
    expect(split.words).toBe(3);
    expect(split.syllablesPerWord).toBe(joined.syllablesPerWord);
    expect(split.utterances).toBe(3);
    expect(joined.utterances).toBe(1);
  });

  it("ignores utterances with no scoreable text", () => {
    expect(analyzeUiReadability(["  ", "—", "Date"]).utterances).toBe(1);
  });
});
