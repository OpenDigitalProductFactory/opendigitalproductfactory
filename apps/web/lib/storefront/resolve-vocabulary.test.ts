import { describe, expect, it } from "vitest";
import { resolveVocabularyKey } from "./resolve-vocabulary";

describe("resolveVocabularyKey", () => {
  it("returns archetype category when present", () => {
    expect(resolveVocabularyKey({ archetypeCategory: "beauty-personal-care", industry: "food-hospitality" }))
      .toBe("beauty-personal-care");
  });

  it("falls back to industry when archetype is absent", () => {
    expect(resolveVocabularyKey({ archetypeCategory: null, industry: "food-hospitality" }))
      .toBe("food-hospitality");
  });

  it("returns null when neither is present", () => {
    expect(resolveVocabularyKey({ archetypeCategory: null, industry: null })).toBeNull();
    expect(resolveVocabularyKey({ archetypeCategory: undefined, industry: undefined })).toBeNull();
  });

  it("prefers non-empty archetype over non-empty industry even if they disagree", () => {
    expect(resolveVocabularyKey({ archetypeCategory: "beauty-personal-care", industry: "retail-goods" }))
      .toBe("beauty-personal-care");
  });
});
