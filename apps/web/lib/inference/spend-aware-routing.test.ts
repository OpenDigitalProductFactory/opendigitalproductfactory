import { describe, it, expect } from "vitest";
import { spendAwareBudgetClass } from "./spend-aware-routing";

describe("spendAwareBudgetClass", () => {
  it("leaves the class untouched below 80% (status ok)", () => {
    expect(spendAwareBudgetClass("quality_first", "ok")).toBe("quality_first");
    expect(spendAwareBudgetClass("balanced", "ok")).toBe("balanced");
    expect(spendAwareBudgetClass("minimize_cost", "ok")).toBe("minimize_cost");
  });

  it("forces minimize_cost at warning_95, from any class", () => {
    expect(spendAwareBudgetClass("quality_first", "warning_95")).toBe("minimize_cost");
    expect(spendAwareBudgetClass("balanced", "warning_95")).toBe("minimize_cost");
    expect(spendAwareBudgetClass("minimize_cost", "warning_95")).toBe("minimize_cost");
  });

  it("steps one notch cheaper at warning_80", () => {
    expect(spendAwareBudgetClass("quality_first", "warning_80")).toBe("balanced");
    expect(spendAwareBudgetClass("balanced", "warning_80")).toBe("minimize_cost");
    // Already cheapest — cannot go lower.
    expect(spendAwareBudgetClass("minimize_cost", "warning_80")).toBe("minimize_cost");
  });

  it("never raises the class (rejected is thrown by the gate, not raised here)", () => {
    expect(spendAwareBudgetClass("minimize_cost", "rejected")).toBe("minimize_cost");
  });

  it("coerces an unknown class to a safe balanced default", () => {
    expect(spendAwareBudgetClass("bogus", "ok")).toBe("balanced");
    expect(spendAwareBudgetClass("bogus", "warning_95")).toBe("minimize_cost");
  });
});

// Phase G (proactivity & capacity allocation §6.1) — a high / governed stage
// floor is never demoted to save budget; that saving is not the operator's.
describe("spendAwareBudgetClass with a declared stage effort", () => {
  it("never downgrades a turn carrying a high floor, at any spend status", () => {
    for (const status of ["ok", "warning_80", "warning_95"] as const) {
      expect(spendAwareBudgetClass("quality_first", status, true)).toBe("quality_first");
      expect(spendAwareBudgetClass("balanced", status, true)).toBe("balanced");
    }
    // An absent class stays absent rather than being rewritten (no spurious downgrade event).
    expect(spendAwareBudgetClass(undefined, "warning_95", true)).toBeUndefined();
  });

  it("still downgrades a turn that may be demoted exactly as before", () => {
    for (const neverDemote of [false, undefined] as const) {
      expect(spendAwareBudgetClass("quality_first", "warning_80", neverDemote)).toBe("balanced");
      expect(spendAwareBudgetClass("quality_first", "warning_95", neverDemote)).toBe("minimize_cost");
    }
  });
});
