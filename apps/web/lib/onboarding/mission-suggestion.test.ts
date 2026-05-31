import { describe, expect, it } from "vitest";

import { suggestMission } from "./mission-suggestion";

describe("suggestMission", () => {
  it("returns a non-empty single-sentence starter for an empty input", () => {
    const s = suggestMission({});
    expect(s.length).toBeGreaterThan(0);
    expect(s.endsWith(".")).toBe(true);
    expect(s[0]).toBe(s[0]?.toUpperCase());
  });

  it("produces an industry-flavoured suggestion for a known category", () => {
    const health = suggestMission({ industry: "healthcare-wellness" });
    expect(health.toLowerCase()).toContain("care");
  });

  it("varies the suggestion across distinct industries", () => {
    const health = suggestMission({ industry: "healthcare-wellness" });
    const food = suggestMission({ industry: "food-hospitality" });
    expect(health).not.toBe(food);
  });

  it("falls back to the generic suggestion for an unknown industry", () => {
    expect(suggestMission({ industry: "something-unmapped" })).toBe(suggestMission({}));
  });

  it("personalises the opening with the org name when provided", () => {
    const s = suggestMission({ orgName: "Acme Dental", industry: "healthcare-wellness" });
    expect(s.startsWith("At Acme Dental, ")).toBe(true);
  });

  it("trims whitespace in the org name and ignores a blank one", () => {
    expect(suggestMission({ orgName: "   " })).toBe(suggestMission({}));
    expect(suggestMission({ orgName: "  Acme  ", industry: "x" })).toBe(
      suggestMission({ orgName: "Acme", industry: "x" }),
    );
  });
});
