import { describe, expect, it } from "vitest";
import {
  classifyDepChange,
  decideRemediationMerge,
  type RemediationMergeFacts,
} from "./remediation-merge-gate";

describe("classifyDepChange", () => {
  it("classifies patch / minor / major forward bumps", () => {
    expect(classifyDepChange("4.12.19", "4.12.25")).toBe("patch");
    expect(classifyDepChange("7.5.8", "7.6.4")).toBe("minor");
    expect(classifyDepChange("8.3.0", "9.0.1")).toBe("major");
  });

  it("tolerates range prefixes on either side", () => {
    expect(classifyDepChange("^4.12.19", "4.12.25")).toBe("patch");
    expect(classifyDepChange("4.12.19", ">=4.13.0")).toBe("minor");
  });

  it("returns unknown for equal, downgrade, or unparseable versions", () => {
    expect(classifyDepChange("1.0.0", "1.0.0")).toBe("unknown");
    expect(classifyDepChange("2.0.0", "1.0.0")).toBe("unknown");
    expect(classifyDepChange("latest", "1.0.0")).toBe("unknown");
    expect(classifyDepChange("1.0.0", "garbage")).toBe("unknown");
  });
});

describe("decideRemediationMerge", () => {
  const green: RemediationMergeFacts = {
    changeClass: "patch",
    ciGreen: true,
    cooldownMet: true,
    osvClean: true,
    hasConflict: false,
  };

  it("auto-merges a patch bump when all preconditions pass", () => {
    expect(decideRemediationMerge(green)).toEqual({
      action: "auto-merge",
      reason: expect.stringContaining("patch"),
    });
  });

  it("escalates minor and major bumps even when green", () => {
    expect(decideRemediationMerge({ ...green, changeClass: "minor" }).action).toBe("escalate");
    expect(decideRemediationMerge({ ...green, changeClass: "major" }).action).toBe("escalate");
  });

  it("escalates an unclassifiable change (uncertainty)", () => {
    const d = decideRemediationMerge({ ...green, changeClass: "unknown" });
    expect(d.action).toBe("escalate");
    expect(d.reason).toContain("uncertain");
  });

  it("escalates on any failed precondition, even for a patch", () => {
    expect(decideRemediationMerge({ ...green, ciGreen: false }).reason).toContain("ci-not-green");
    expect(decideRemediationMerge({ ...green, osvClean: false }).reason).toContain("osv-target-not-clean");
    expect(decideRemediationMerge({ ...green, cooldownMet: false }).reason).toContain("cooldown-not-met");
    expect(decideRemediationMerge({ ...green, hasConflict: true }).reason).toContain("merge-conflict");
  });

  it("checks merge-conflict before anything else", () => {
    const d = decideRemediationMerge({
      changeClass: "patch",
      ciGreen: false,
      cooldownMet: false,
      osvClean: false,
      hasConflict: true,
    });
    expect(d.reason).toContain("merge-conflict");
  });
});
