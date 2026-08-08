import { describe, expect, it } from "vitest";
import {
  FLUXFORGE_MOTION_REFERENCE,
  validateManufacturingReference,
} from "./manufacturing-reference";

describe("manufacturing reference company", () => {
  it("is internally complete and safe for deterministic reuse", () => {
    expect(validateManufacturingReference(FLUXFORGE_MOTION_REFERENCE)).toEqual([]);
    expect(FLUXFORGE_MOTION_REFERENCE.legalNotice).toContain("fictional");
    expect(FLUXFORGE_MOTION_REFERENCE.company.archetypeTarget).toBe("industrial-oem");
    expect(FLUXFORGE_MOTION_REFERENCE.sites.map((site) => site.countryCode)).toEqual(
      expect.arrayContaining(["US", "MX"]),
    );
  });

  it("models the complete plant-to-equipment hierarchy", () => {
    const kinds = new Set(FLUXFORGE_MOTION_REFERENCE.topology.map((node) => node.kind));
    expect(kinds).toEqual(
      new Set(["enterprise", "site", "area", "line", "cell", "station", "equipment"]),
    );
  });

  it("keeps every industrial connection observe-only", () => {
    expect(
      FLUXFORGE_MOTION_REFERENCE.equipment.every(
        (equipment) => equipment.controlBoundary === "observe-only",
      ),
    ).toBe(true);
    expect(FLUXFORGE_MOTION_REFERENCE.signals.every((signal) => signal.writable === false)).toBe(
      true,
    );
  });

  it("separates stable equipment identity from timestamped observations", () => {
    expect(FLUXFORGE_MOTION_REFERENCE.equipment.every((equipment) => !("state" in equipment))).toBe(
      true,
    );
    for (const observation of FLUXFORGE_MOTION_REFERENCE.observations) {
      expect(Date.parse(observation.receivedAt)).toBeGreaterThanOrEqual(
        Date.parse(observation.sourceObservedAt),
      );
    }
  });

  it("makes each performance measure traceable to declared signals", () => {
    const keys = new Set(FLUXFORGE_MOTION_REFERENCE.signals.map((signal) => signal.key));
    for (const metric of FLUXFORGE_MOTION_REFERENCE.metrics) {
      expect(metric.sourceSignalKeys.length).toBeGreaterThan(0);
      expect(metric.sourceSignalKeys.every((key) => keys.has(key))).toBe(true);
      expect(metric.freshnessSeconds).toBeGreaterThan(0);
    }
  });

  it("contains actionable disruption and stale-evidence golden scenarios", () => {
    expect(FLUXFORGE_MOTION_REFERENCE.scenarios.length).toBeGreaterThanOrEqual(3);
    for (const scenario of FLUXFORGE_MOTION_REFERENCE.scenarios) {
      expect(scenario.facts.length).toBeGreaterThan(0);
      expect(scenario.expectedOperationsDecision.length).toBeGreaterThan(20);
      expect(scenario.expectedPerformanceEffect.length).toBeGreaterThan(0);
      expect(scenario.provesBacklogItems.length).toBeGreaterThan(0);
    }
  });
});
