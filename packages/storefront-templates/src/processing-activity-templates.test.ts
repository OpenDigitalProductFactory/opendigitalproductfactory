import { describe, expect, it } from "vitest";
import { ALL_ARCHETYPES } from "./archetypes";
import { processingActivityTemplatesForArchetype } from "./processing-activity-templates";

describe("processing activity archetype proposals", () => {
  it("provides deterministic review-only proposals for every archetype", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const first = processingActivityTemplatesForArchetype(archetype.category);
      const second = processingActivityTemplatesForArchetype(archetype.category);
      expect(first).toEqual(second);
      expect(first.length).toBeGreaterThanOrEqual(2);
      expect(first.every((template) => template.initialStatus === "review")).toBe(true);
      expect(first.every((template) => template.authorityRefs.length === 0)).toBe(true);
    }
  });

  it("keeps template ids unique within each archetype category", () => {
    for (const category of new Set(ALL_ARCHETYPES.map((archetype) => archetype.category))) {
      const ids = processingActivityTemplatesForArchetype(category).map(
        (template) => template.templateId,
      );
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
