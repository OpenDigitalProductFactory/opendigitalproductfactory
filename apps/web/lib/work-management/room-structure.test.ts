import { describe, expect, it } from "vitest";

import {
  resolveWorkRoomStructure,
  workRoomStructureSubjectFor,
} from "./room-structure";

describe("resolveWorkRoomStructure", () => {
  it("returns null for a null subject (no value-stream/lifecycle binding)", () => {
    expect(resolveWorkRoomStructure(null)).toBeNull();
  });

  it("folds an opportunity subject onto its OVSM stage + lifecycle grammar", () => {
    const structure = resolveWorkRoomStructure({ kind: "opportunity", stage: "qualification" });
    expect(structure).not.toBeNull();
    expect(structure?.valueStream).not.toBeNull();
    expect(structure?.lifecycle?.grammarKey).toBe("opportunity");
    // The lifecycle carries a resolved stage/state and a health band.
    expect(typeof structure?.lifecycle?.stageLabel).toBe("string");
    expect(structure?.lifecycle?.band).toBeDefined();
  });

  it("folds a customer-account subject onto its OVSM stage + lifecycle grammar", () => {
    const structure = resolveWorkRoomStructure({ kind: "customer-account", status: "active" });
    expect(structure?.lifecycle?.grammarKey).toBe("customer-account");
    expect(structure?.valueStream?.label.length ?? 0).toBeGreaterThan(0);
  });

  it("derives advancement gates from the current stage with a typed allow/refuse per target", () => {
    const structure = resolveWorkRoomStructure({ kind: "opportunity", stage: "qualification" });
    const gates = structure?.lifecycle?.nextGates ?? [];
    expect(gates.length).toBeGreaterThan(0);
    for (const gate of gates) {
      expect(typeof gate.toStage).toBe("string");
      expect(typeof gate.toStageLabel).toBe("string");
      expect(typeof gate.allowed).toBe("boolean");
      // A refused gate must explain why; an allowed gate needs no reason.
      if (!gate.allowed) expect(gate.reason).toBeTruthy();
    }
  });
});

describe("workRoomStructureSubjectFor", () => {
  it("maps an opportunity source with a stage to an opportunity subject", () => {
    expect(workRoomStructureSubjectFor({ sourceType: "opportunity", opportunityStage: "proposal" })).toEqual({
      kind: "opportunity",
      stage: "proposal",
    });
  });

  it("maps account-backed sources with a status to a customer-account subject", () => {
    for (const sourceType of ["engagement", "activity", "booking", "storefront-booking"]) {
      expect(workRoomStructureSubjectFor({ sourceType, accountStatus: "at_risk" })).toEqual({
        kind: "customer-account",
        status: "at_risk",
      });
    }
  });

  it("returns null when the subject stage/status is missing or the source has no binding", () => {
    expect(workRoomStructureSubjectFor({ sourceType: "opportunity", opportunityStage: null })).toBeNull();
    expect(workRoomStructureSubjectFor({ sourceType: "backlog-item" })).toBeNull();
    expect(workRoomStructureSubjectFor({ sourceType: "work-capsule" })).toBeNull();
  });
});
