import { describe, expect, it } from "vitest";

import {
  OWNER_FACING_AREAS,
  ownerFacingAreaForPortfolio,
} from "./owner-areas";

describe("ownerFacingAreaForPortfolio", () => {
  it("orders the four canonical portfolios from customers inward", () => {
    expect(OWNER_FACING_AREAS.map((area) => area.label)).toEqual([
      "Customers and sales",
      "Your team",
      "Operations and delivery",
      "Platform and back office",
    ]);
  });

  it("keeps unmapped coworkers visible in Other", () => {
    expect(ownerFacingAreaForPortfolio(null)).toEqual({
      key: "other",
      label: "Other",
      order: 5,
    });
    expect(ownerFacingAreaForPortfolio("unmapped")).toEqual({
      key: "other",
      label: "Other",
      order: 5,
    });
  });
});
