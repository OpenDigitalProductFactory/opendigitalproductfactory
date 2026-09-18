import { describe, expect, it } from "vitest";
import {
  GOVERNED_CODE_DISPOSITION,
  GOVERNED_REFUSAL_CODES,
  governedRefusalDisposition,
  isGovernedRefusal,
} from "./refusal-codes";
import { GOVERNED_REJECTION_DISPOSITION } from "@/lib/govern/authority/governed-rejection-disposition";
import { OUTCOME_DISPOSITIONS } from "@/lib/shared/outcome-disposition";

describe("governed code classification (BI-AF9E4906)", () => {
  it("cannot go stale against the governed-execute seam", () => {
    // The whole point: a rejection classified at the seam is classified here by
    // construction, so adding one there cannot leave this scan behind.
    for (const [code, disposition] of Object.entries(GOVERNED_REJECTION_DISPOSITION)) {
      expect(GOVERNED_CODE_DISPOSITION[code]).toBe(disposition);
    }
  });

  it("classifies every code to a known disposition", () => {
    for (const disposition of Object.values(GOVERNED_CODE_DISPOSITION)) {
      expect(OUTCOME_DISPOSITIONS).toContain(disposition);
    }
  });

  it("tells a wait apart from a refusal", () => {
    // The conflation this item exists to fix: both were one label before.
    expect(governedRefusalDisposition({ error: "approval_required" })).toBe("awaiting-person");
    expect(governedRefusalDisposition({ error: "branch_occupied" })).toBe("refused");
    expect(governedRefusalDisposition({ error: "gate_evidence_blocked" })).toBe("awaiting-input");
  });

  it("leaves an unclassified code a fault, so a broken tool is never excused", () => {
    expect(governedRefusalDisposition({ error: "some_tool_actually_broke" })).toBeNull();
    expect(isGovernedRefusal({ error: "some_tool_actually_broke" })).toBe(false);
    expect(isGovernedRefusal({})).toBe(false);
    expect(isGovernedRefusal(null)).toBe(false);
    expect(isGovernedRefusal("approval_required")).toBe(false);
  });

  it("keeps the boolean contract its one caller still reads", () => {
    expect(isGovernedRefusal({ error: "gate_evidence_blocked" })).toBe(true);
    expect(GOVERNED_REFUSAL_CODES.has("gate_evidence_blocked")).toBe(true);
  });
});
