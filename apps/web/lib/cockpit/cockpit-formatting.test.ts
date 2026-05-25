import { describe, expect, it } from "vitest";
import {
  formatCost,
  formatPercent,
  formatTorque,
  summarizeInterface,
  torqueColor,
  type CockpitInterfaceReading,
} from "./cockpit-formatting";

describe("Cockpit formatting helpers", () => {
  it("formats torque, percentages, and costs consistently", () => {
    expect(formatTorque(0.734)).toBe("73%");
    expect(formatPercent(0.221)).toBe("22.1%");
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.0042)).toBe("$0.0042");
    expect(formatCost(47)).toBe("$47.00");
  });

  it("maps torque values to DPF semantic tokens", () => {
    expect(torqueColor(0.95)).toBe("var(--dpf-success)");
    expect(torqueColor(0.7)).toBe("var(--dpf-warning)");
    expect(torqueColor(0.3)).toBe("var(--dpf-error)");
  });

  it("summarizes interface readings by sample size", () => {
    const readings: CockpitInterfaceReading[] = [
      {
        innerRing: 1,
        outerRing: 2,
        transmissionDirection: "outward",
        totalRecords: 3,
        meanTorqueTechnical: 1,
        meanTorqueConfidence: 0.8,
        slipCount: 0,
        slipRate: 0,
        graduationCount: 1,
        totalCostUsd: 2,
      },
      {
        innerRing: 1,
        outerRing: 2,
        transmissionDirection: "outward",
        totalRecords: 1,
        meanTorqueTechnical: 0,
        meanTorqueConfidence: 0.8,
        slipCount: 1,
        slipRate: 1,
        graduationCount: 0,
        totalCostUsd: 5,
      },
    ];

    expect(summarizeInterface(readings)).toEqual({
      total: 4,
      weightedTorque: 0.75,
      slipRate: 0.25,
      totalCost: 7,
      graduations: 1,
    });
    expect(summarizeInterface([])).toBeNull();
  });
});
