import { describe, expect, it } from "vitest";
import { ALL_ARCHETYPES } from "./archetypes";
import { deriveArchetypeBusinessViews } from "./business-view-profile";
import {
  getPerformanceMetricDefinition,
  PRIORITY_PHYSICAL_VIEW_PACKS,
} from "./performance-metric-catalog";

function metricKeys(performance: ReturnType<typeof deriveArchetypeBusinessViews>["performance"]) {
  return [
    ...performance.headline,
    ...performance.operating,
    ...performance.financial,
    ...performance.customer,
    ...performance.workforce,
  ];
}

describe("deriveArchetypeBusinessViews", () => {
  it("derives exactly one bounded operations and performance contract for every seeded archetype", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const views = deriveArchetypeBusinessViews(archetype);

      expect(views.archetypeId).toBe(archetype.archetypeId);
      expect(views.operations.sceneAdapter).toBeTruthy();
      expect(views.operations.currentStateSelector).toBeTruthy();
      expect(views.operations.commandKinds.length).toBeGreaterThan(0);
      expect(views.operations.commandKinds.length).toBeLessThanOrEqual(4);
      const keys = metricKeys(views.performance);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.length).toBeLessThanOrEqual(10);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.every((key) => getPerformanceMetricDefinition(key))).toBe(true);
    }
  });

  it("requires a list or table equivalent for every physical twin", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const views = deriveArchetypeBusinessViews(archetype);
      if (views.operations.twinProfile.physical) {
        expect(["list", "table"]).toContain(views.operations.textAlternative);
      }
    }
  });

  it("binds all six priority physical packs to industry space, job, and metrics", () => {
    expect(Object.keys(PRIORITY_PHYSICAL_VIEW_PACKS)).toEqual([
      "restaurant",
      "hair-salon",
      "independent-hotel",
      "equipment-rental",
      "homeowners-association",
      "hvac-contractor",
    ]);
    for (const pack of Object.values(PRIORITY_PHYSICAL_VIEW_PACKS)) {
      expect(pack.spaceKind.length).toBeGreaterThan(8);
      expect(pack.operatorJob.length).toBeGreaterThan(20);
      const keys = [
        ...pack.performance.headline,
        ...pack.performance.operating,
        ...pack.performance.financial,
        ...pack.performance.customer,
        ...pack.performance.workforce,
      ];
      expect(keys.length).toBeGreaterThanOrEqual(6);
      expect(keys.length).toBeLessThanOrEqual(10);
      expect(keys.every((key) => getPerformanceMetricDefinition(key))).toBe(true);
    }
  });

  it("binds seeded priority archetypes to their industry operational grammar", () => {
    const byId = (id: string) => deriveArchetypeBusinessViews(
      ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === id)!,
    );

    expect(byId("restaurant").operations.twinProfile.template).toBe("FLOOR");
    expect(byId("restaurant").operations.commandKinds).toContain("seat-party");
    expect(byId("catering").operations.twinProfile.template).toBe("VENUE");
    expect(byId("catering").operations.commandKinds).toContain("allocate-space");
    expect(byId("bakery").operations.twinProfile.template).toBe("BAYS");
    expect(byId("bakery").operations.commandKinds).toContain("change-work-state");
    expect(byId("hair-salon").operations.twinProfile.template).toBe("BOOK");
    expect(byId("equipment-rental").operations.twinProfile.template).toBe("YARD");
    expect(byId("homeowners-association").operations.commandKinds).toContain("prioritize-work");
    expect(byId("hvac-contractor").operations.commandKinds).toContain("assign-job");
    expect(byId("homeowners-association").performance.headline).toContain("open-aging-actions");
    expect(byId("hvac-contractor").performance.headline).toContain("technician-utilization");
  });

  it("returns deterministic profiles without page-local configuration", () => {
    for (const archetype of ALL_ARCHETYPES) {
      expect(deriveArchetypeBusinessViews(archetype)).toEqual(
        deriveArchetypeBusinessViews(archetype),
      );
    }
  });
});
