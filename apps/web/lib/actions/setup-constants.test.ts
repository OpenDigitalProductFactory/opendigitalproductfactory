import { describe, expect, it } from "vitest";
import { STEP_ROUTES } from "./setup-constants";

describe("STEP_ROUTES", () => {
  it("points business setup steps at the Business-side storefront settings routes", () => {
    expect(STEP_ROUTES["business-context"]).toBe("/storefront/settings/business");
    expect(STEP_ROUTES["operating-hours"]).toBe("/storefront/settings/operations");
  });
});
