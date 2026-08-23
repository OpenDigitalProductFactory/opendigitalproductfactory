import { describe, expect, it } from "vitest";

import {
  SELECTABLE_COWORKER_STATE,
  collapseDualSeedDuplicates,
  dropDualSeedAliasAgents,
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


describe("collapseDualSeedDuplicates", () => {
  const MAP = { "compliance-officer": "AGT-WS-COMPLIANCE" } as const;

  it("keeps the canonical row and drops its slug twin", () => {
    const rows = [{ agentId: "compliance-officer" }, { agentId: "AGT-WS-COMPLIANCE" }];
    expect(collapseDualSeedDuplicates(rows, MAP).map((r) => r.agentId)).toEqual([
      "AGT-WS-COMPLIANCE",
    ]);
  });

  it("keeps a canonical row whose slug twin is absent — the difference from dropDualSeedAliasAgents", () => {
    // dropDualSeedAliasAgents drops this, because a roster lists selectable
    // coworkers. An inventory surface must still show a declared agent.
    const rows = [{ agentId: "AGT-WS-COMPLIANCE" }];
    expect(collapseDualSeedDuplicates(rows, MAP).map((r) => r.agentId)).toEqual([
      "AGT-WS-COMPLIANCE",
    ]);
    expect(dropDualSeedAliasAgents(rows, MAP)).toEqual([]);
  });

  it("keeps a slug row whose canonical twin is absent", () => {
    const rows = [{ agentId: "compliance-officer" }];
    expect(collapseDualSeedDuplicates(rows, MAP).map((r) => r.agentId)).toEqual([
      "compliance-officer",
    ]);
  });
});
