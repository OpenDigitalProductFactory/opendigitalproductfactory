import { describe, expect, it } from "vitest";

import {
  resolveTemplateDefinition,
  templateOperatingWindows,
} from "./archetype-operating-profile";

describe("archetype operating profile", () => {
  it("resolves an existing archetype by its canonical id", () => {
    expect(resolveTemplateDefinition("pet-rescue")?.name).toMatch(/rescue/i);
    expect(resolveTemplateDefinition("missing-archetype")).toBeUndefined();
  });

  it("projects restaurant template hours into operating windows", () => {
    const definition = resolveTemplateDefinition("restaurant");
    expect(definition).toBeTruthy();
    expect(templateOperatingWindows(definition!)).toEqual(
      (definition!.schedulingDefaults?.defaultOperatingHours ?? []).map(
        (hours) => ({
          day: hours.day,
          start: hours.start,
          end: hours.end,
        }),
      ),
    );
  });
});
