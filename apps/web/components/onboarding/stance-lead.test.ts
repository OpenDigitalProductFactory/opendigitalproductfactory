import { describe, expect, it } from "vitest";
import { splitStanceLead } from "@/components/onboarding/HowYouDecideCards";
import { GENERIC_STANCE_VECTORS, STANCE_VECTOR_KEYS } from "@/lib/onboarding/archetype-business-context";

describe("splitStanceLead", () => {
  it("keeps a short stance whole rather than costing a click to hide nothing", () => {
    const { lead, rest } = splitStanceLead("We fix it at our cost.");
    expect(lead).toBe("We fix it at our cost.");
    expect(rest).toBe("");
  });

  it("puts the deciding sentence in the lead and the rest behind disclosure", () => {
    const { lead, rest } = splitStanceLead(GENERIC_STANCE_VECTORS["data-handling"].stance);
    expect(lead).toMatch(/least personal information/i);
    expect(rest.length).toBeGreaterThan(0);
    expect(lead.length).toBeLessThan(GENERIC_STANCE_VECTORS["data-handling"].stance.length);
  });

  it("holds the visible lead well under the route word budget across every vector", () => {
    const words = STANCE_VECTOR_KEYS.map(
      (k) => splitStanceLead(GENERIC_STANCE_VECTORS[k].stance).lead.split(/\s+/).length,
    );
    // 450-word route budget, shared with page chrome and the rest of the shell.
    expect(words.reduce((a, b) => a + b, 0)).toBeLessThan(250);
  });

  it("loses no content — lead plus rest reconstitutes the stance", () => {
    for (const k of STANCE_VECTOR_KEYS) {
      const s = GENERIC_STANCE_VECTORS[k].stance;
      const { lead, rest } = splitStanceLead(s);
      expect(`${lead} ${rest}`.trim().replace(/\s+/g, " ")).toBe(s.trim().replace(/\s+/g, " "));
    }
  });
});
