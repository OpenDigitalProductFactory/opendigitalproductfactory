import { describe, expect, it } from "vitest";
import { resolveArchetypeSummaryState } from "./business-context-form-state";

describe("resolveArchetypeSummaryState", () => {
  it("returns 'picked' with name + label when archetype is set", () => {
    const s = resolveArchetypeSummaryState({ name: "Nail Salon", category: "beauty-personal-care" });
    expect(s.kind).toBe("picked");
    if (s.kind === "picked") {
      expect(s.name).toBe("Nail Salon");
      expect(s.industryLabel).toBe("Beauty & Personal Care");
    }
  });

  it("returns 'empty' with a setup hint when archetype is null", () => {
    const s = resolveArchetypeSummaryState(null);
    expect(s.kind).toBe("empty");
    if (s.kind === "empty") {
      expect(s.setupHref).toBe("/storefront/setup");
    }
  });

  it("falls back to the raw slug when category is not in the canonical list", () => {
    const s = resolveArchetypeSummaryState({ name: "Custom", category: "weird-slug" });
    expect(s.kind).toBe("picked");
    if (s.kind === "picked") {
      expect(s.industryLabel).toBe("weird-slug");
    }
  });
});
