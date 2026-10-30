import { describe, expect, it } from "vitest";
import { SETUP_STEPS, STEP_ROUTES } from "./setup-constants";

describe("STEP_ROUTES", () => {
  it("points business setup steps at the Business-side storefront settings routes", () => {
    expect(STEP_ROUTES["business-context"]).toBe("/storefront/settings/business");
    expect(STEP_ROUTES["operating-hours"]).toBe("/storefront/settings/operations");
  });

  it("asks for the instance's direction right after the business step (BI-916216E7 AC-1)", () => {
    expect(SETUP_STEPS.indexOf("direction")).toBe(SETUP_STEPS.indexOf("business-context") + 1);
    // A query string, not a hash: the overlay navigates by full reload, and a
    // hash change on the same path would not re-render the step.
    expect(STEP_ROUTES["direction"]).toBe("/storefront/settings/business?section=direction");
  });

  it("points the decision-style setup step at the renamed coworker decisions surface", () => {
    expect(STEP_ROUTES["how-you-decide"]).toBe("/coworker-decisions/stance");
  });
});
