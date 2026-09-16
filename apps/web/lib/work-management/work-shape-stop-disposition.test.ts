import { describe, expect, it } from "vitest";

import { DELIVERY_SHAPES } from "./delivery-shapes";
import { OUTCOME_DISPOSITIONS } from "@/lib/shared/outcome-disposition";

// BI-77CFC7BF. A shape's stop conditions said whether it ended well, badly or
// out of budget — never what happens next. The authors wrote that in English
// inside `condition` because the type could not hold it.
describe("delivery work shapes declare how they stop (BI-77CFC7BF)", () => {
  const stops = Object.values(DELIVERY_SHAPES).flatMap((s) => s.stopConditions ?? []);

  it("classifies every delivery-shape stop condition", () => {
    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) {
      expect(stop.disposition).toBeDefined();
      expect(OUTCOME_DISPOSITIONS).toContain(stop.disposition!);
    }
  });

  it("does not let `kind` stand in for the disposition", () => {
    // The whole reason the field exists. If kind determined disposition it
    // would be derivable and this file would be pointless.
    const budgets = stops.filter((s) => s.kind === "budget").map((s) => s.disposition);
    const failures = stops.filter((s) => s.kind === "failure").map((s) => s.disposition);

    // "refused; the lane is WIP 1" is a budget stop that is a settled no...
    expect(budgets).toContain("refused");
    // ...while "the room stops for reshaping" is a budget stop the caller can act on.
    expect(budgets).toContain("awaiting-input");
    // And a "failure" that says "reshape to large" is not a refusal at all.
    expect(failures).toContain("awaiting-input");
    expect(new Set(budgets).size).toBeGreaterThan(1);
  });

  it("marks a successful stop as proceed", () => {
    for (const stop of stops.filter((s) => s.kind === "success")) {
      expect(stop.disposition).toBe("proceed");
    }
  });
});
