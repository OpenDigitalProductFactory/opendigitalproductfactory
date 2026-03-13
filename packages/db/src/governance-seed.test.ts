import { describe, expect, it } from "vitest";
import { getDefaultCapabilityClasses, getDefaultDirectivePolicyClasses } from "./governance-seed";

describe("governance seed defaults", () => {
  it("returns stable capability classes", () => {
    expect(getDefaultCapabilityClasses().map((c) => c.capabilityClassId)).toEqual([
      "cap-advisory",
      "cap-operator",
      "cap-specialist",
      "cap-elevated",
    ]);
  });

  it("returns stable directive policy classes", () => {
    expect(getDefaultDirectivePolicyClasses().map((p) => p.policyClassId)).toContain("dir-workflow-standard");
  });
});
