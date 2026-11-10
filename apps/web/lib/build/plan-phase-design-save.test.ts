import { describe, expect, it } from "vitest";

import { redirectsPlanPhaseDesignSave } from "./plan-phase-design-save";

describe("redirectsPlanPhaseDesignSave (BI-3E57890E)", () => {
  it("still redirects a coworker that saves a design while the build is in plan", () => {
    expect(redirectsPlanPhaseDesignSave({ phase: "plan", field: "designDoc" })).toBe(true);
  });

  it("saves the design-fix loop's revision of a plan-phase design", () => {
    expect(redirectsPlanPhaseDesignSave({ phase: "plan", field: "designDoc", allowPlanPhaseDesignRevision: true })).toBe(false);
  });

  it("never applies outside plan or to other fields", () => {
    expect(redirectsPlanPhaseDesignSave({ phase: "ideate", field: "designDoc" })).toBe(false);
    expect(redirectsPlanPhaseDesignSave({ phase: "plan", field: "buildPlan" })).toBe(false);
  });
});
