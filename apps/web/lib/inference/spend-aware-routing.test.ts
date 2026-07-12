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
