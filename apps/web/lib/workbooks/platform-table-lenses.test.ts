import { describe, expect, it } from "vitest";

import { getHomeSurfaceForEntity } from "./platform-tables";

describe("platform table default data lenses (BI-9DB20C39)", () => {
  it.each([
    ["backlog_item", "status", "in", ["triaging", "open", "in-progress"]],
    ["risk_assessment", "status", "eq", "active"],
    ["compliance_control", "status", "eq", "active"],
    ["compliance_obligation", "status", "eq", "active"],
    ["opportunity", "stage", "in", ["qualification", "discovery", "proposal", "negotiation"]],
    ["customer_account", "status", "neq", "superseded"],
  ])(
    "%s matches its List surface default",
    (entityType, field, operator, value) => {
      expect(getHomeSurfaceForEntity(entityType)?.defaultDataLens?.filter).toEqual({
        conditions: [{ field, operator, value }],
        logic: "and",
      });
    },
  );

  it("leaves all-record List surfaces without an invented default lens", () => {
    expect(getHomeSurfaceForEntity("invoice")?.defaultDataLens).toBeUndefined();
    expect(getHomeSurfaceForEntity("supplier")?.defaultDataLens).toBeUndefined();
  });
});
