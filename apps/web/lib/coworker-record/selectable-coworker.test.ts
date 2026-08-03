import { describe, expect, it } from "vitest";

import {
  SELECTABLE_COWORKER_STATE,
  selectableCoworkerIdentityRefs,
} from "./selectable-coworker";

describe("selectable coworker identity", () => {
  it("resolves a canonical record and its executable slug identity", () => {
    expect(selectableCoworkerIdentityRefs("AGT-WS-CUSTOMER")).toEqual({
      canonicalAgentId: "AGT-WS-CUSTOMER",
      runtimeAgentId: "customer-advisor",
    });
    expect(selectableCoworkerIdentityRefs("customer-advisor")).toEqual({
      canonicalAgentId: "AGT-WS-CUSTOMER",
      runtimeAgentId: "customer-advisor",
    });
    expect(selectableCoworkerIdentityRefs("farm-ranch-steward")).toEqual({
      canonicalAgentId: "AGT-WS-FARM-RANCH",
      runtimeAgentId: "farm-ranch-steward",
    });
  });

  it("uses the same active production predicate on every entry path", () => {
    expect(SELECTABLE_COWORKER_STATE).toEqual({
      status: "active",
      archived: false,
      lifecycleStage: "production",
    });
  });
});
