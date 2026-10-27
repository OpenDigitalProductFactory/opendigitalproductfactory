import { describe, expect, it } from "vitest";

import {
  resolveWorkroomStructure,
  workroomStructureSubjectFor,
} from "./room-structure";

describe("resolveWorkroomStructure", () => {
  it("returns null for a null subject (no value-stream/lifecycle binding)", () => {
    expect(resolveWorkroomStructure(null)).toBeNull();
  });

  it("folds an opportunity subject onto its OVSM stage + lifecycle grammar", () => {
    const structure = resolveWorkroomStructure({ kind: "opportunity", stage: "qualification" });
    expect(structure).not.toBeNull();
    expect(structure?.valueStream).not.toBeNull();
    expect(structure?.lifecycle?.grammarKey).toBe("opportunity");
    // The lifecycle carries a resolved stage/state and a health band.
    expect(typeof structure?.lifecycle?.stageLabel).toBe("string");
    expect(structure?.lifecycle?.band).toBeDefined();
  });

  it("folds a customer-account subject onto its OVSM stage + lifecycle grammar", () => {
    const structure = resolveWorkroomStructure({ kind: "customer-account", status: "active" });
    expect(structure?.lifecycle?.grammarKey).toBe("customer-account");
    expect(structure?.valueStream?.label.length ?? 0).toBeGreaterThan(0);
  });

  it("derives advancement gates from the current stage with a typed allow/refuse per target", () => {
    const structure = resolveWorkroomStructure({ kind: "opportunity", stage: "qualification" });
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

describe("workroomStructureSubjectFor", () => {
  it("maps an opportunity source with a stage to an opportunity subject", () => {
    expect(workroomStructureSubjectFor({ sourceType: "opportunity", opportunityStage: "proposal" })).toEqual({
      kind: "opportunity",
      stage: "proposal",
    });
  });

  it("maps account-backed sources with a status to a customer-account subject", () => {
    for (const sourceType of ["engagement", "activity", "booking", "storefront-booking"]) {
      expect(workroomStructureSubjectFor({ sourceType, accountStatus: "at_risk" })).toEqual({
        kind: "customer-account",
        status: "at_risk",
      });
    }
  });

  it("returns null when the subject stage/status is missing or the source has no binding", () => {
    expect(workroomStructureSubjectFor({ sourceType: "opportunity", opportunityStage: null })).toBeNull();
    expect(workroomStructureSubjectFor({ sourceType: "backlog-item" })).toBeNull();
    expect(workroomStructureSubjectFor({ sourceType: "work-capsule" })).toBeNull();
  });
});

// BI-B8B3FB70: a platform delivery room sits at an IT4IT 3.0.1 stage.
describe("a platform delivery room on the IT4IT value streams", () => {
  const stage = { participationReference: "5.3.4", stageName: "Build, Integrate, & Test Stage", streamName: "Integrate" };

  it("names its IT4IT stream and stage and carries the participationReference for Edge 2", () => {
    const structure = resolveWorkroomStructure({ kind: "platform-delivery", stage });
    expect(structure?.valueStream).toEqual({
      reference: "it4it-3.0.1",
      stream: "Integrate",
      stage: "Build, Integrate, & Test Stage",
      participationReference: "5.3.4",
      label: "Integrate · Build, Integrate, & Test Stage",
    });
  });

  it("follows the shared lifecycle grammar: stage, in-stage state and the gate to the next stage", () => {
    const lifecycle = resolveWorkroomStructure({ kind: "platform-delivery", stage })?.lifecycle;
    expect(lifecycle).toMatchObject({ grammarKey: "platform-delivery", stage: "5.3.4", state: "in-stage", band: "on-track" });
    expect(lifecycle?.nextGates).toEqual([{ toStage: "5.3.5", toStageLabel: "Accept & Publish Release", allowed: true }]);
  });

  it("keeps a stream and stage but no lifecycle for a reference the delivery grammar does not cover", () => {
    const structure = resolveWorkroomStructure({ kind: "platform-delivery", stage: { participationReference: "5.7.2", stageName: "Detect", streamName: "Operate" } });
    expect(structure?.valueStream?.label).toBe("Operate · Detect");
    expect(structure?.lifecycle).toBeNull();
  });

  it("maps backlog-item and work-capsule rooms with a resolved stage, and nothing without one", () => {
    for (const sourceType of ["backlog-item", "work-capsule"]) {
      expect(workroomStructureSubjectFor({ sourceType, deliveryStage: stage })).toEqual({ kind: "platform-delivery", stage });
      expect(workroomStructureSubjectFor({ sourceType, deliveryStage: null })).toBeNull();
    }
    expect(workroomStructureSubjectFor({ sourceType: "opportunity", deliveryStage: stage })).toBeNull();
  });
});
