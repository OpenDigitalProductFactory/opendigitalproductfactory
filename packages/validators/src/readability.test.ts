import { describe, it, expect } from "vitest";
import {
  analyzeReadability,
  analyzeUtteranceReadability,
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

describe("analyzeUtteranceReadability", () => {
  it("scores each UI utterance as its own sentence", () => {
    const ui = analyzeUtteranceReadability(UI_LABELS);
    expect(ui.sentences).toBe(UI_LABELS.length);
    expect(ui.wordsPerSentence).toBeLessThan(2);
  });

  it("cannot be gamed by adding full stops", () => {
    const bare = analyzeUtteranceReadability(UI_LABELS);
    const stopped = analyzeUtteranceReadability(UI_LABELS.map((l) => `${l}.`));
    expect(stopped.gradeLevel).toBe(bare.gradeLevel);
    expect(stopped.sentences).toBe(bare.sentences);
  });

  it("agrees with the prose analyzer on a single prose utterance", () => {
    const prose = "the cat sat on the mat and the dog ran to the log";
    expect(analyzeUtteranceReadability([prose])).toEqual(analyzeReadability(prose));
    expect(analyzeUtteranceReadability([JARGON])).toEqual(analyzeReadability(JARGON));
  });

  it("still splits genuine prose inside one utterance on its full stops", () => {
    const paragraph = "We sorted your drives. Three still need a category. Pick one for each.";
    expect(analyzeUtteranceReadability([paragraph]).sentences).toBe(3);
  });

  it("still catches jargon on a label-shaped surface", () => {
    // The point of the correction is a measure that separates plain from dense
    // WITHOUT counting periods. Both surfaces are pure one-word labels.
    const plain = analyzeUtteranceReadability(["Date", "Route", "Miles", "Sorted", "Owed"]);
    const dense = analyzeUtteranceReadability([
      "Infrastructure",
      "Optimization",
      "Administrative",
      "Documentation",
      "Organizational",
    ]);
    expect(plain.wordsPerSentence).toBe(dense.wordsPerSentence);
    expect(withinReadingLevel(plain.gradeLevel, "high-school")).toBe(true);
    expect(withinReadingLevel(dense.gradeLevel, "high-school")).toBe(false);
  });

  it("ignores utterances with no scoreable text", () => {
    expect(analyzeUtteranceReadability(["  ", "—", "Date"]).sentences).toBe(1);
  });
});
