import { describe, expect, it } from "vitest";
import { staffingPack } from "./staffing-pack";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

// EP-WORKFORCE-OPS / BI-4AD09A35 Phase 5 — the staffing read pack shape.
// The cross-pack drift guard (tool-registry.test.ts) asserts pack grants match
// TOOL_TO_GRANTS globally; this test pins the pack's own contract.

describe("staffingPack", () => {
  it("declares the read tools with no side effects", () => {
    const names = staffingPack.definitions.map((d) => d.name).sort();
    expect(names).toEqual(["get_staffing_coverage", "list_staffing_demand"]);
    for (const def of staffingPack.definitions) {
      expect(def.sideEffect).toBe(false);
      expect(def.executionMode).toBe("immediate");
      expect(def.requiredCapability).toBe("view_employee");
    }
  });

  it("has a handler for every declared tool and vice versa", () => {
    const defNames = new Set(staffingPack.definitions.map((d) => d.name));
    const handlerNames = new Set(Object.keys(staffingPack.handlers));
    expect(handlerNames).toEqual(defNames);
  });

  it("mirrors the gating source (grants match TOOL_TO_GRANTS)", () => {
    for (const [tool, grants] of Object.entries(staffingPack.grants)) {
      expect(TOOL_TO_GRANTS[tool], `${tool} missing from TOOL_TO_GRANTS`).toEqual(grants);
    }
  });

  it("keeps the read tools on the registry_read baseline (deny-by-default posture)", () => {
    expect(staffingPack.grants.list_staffing_demand).toEqual(["registry_read"]);
    expect(staffingPack.grants.get_staffing_coverage).toEqual(["registry_read"]);
  });
});
