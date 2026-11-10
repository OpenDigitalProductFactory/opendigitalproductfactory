import { describe, expect, it } from "vitest";

import { buildAnimalIntakeRequirementSnapshot } from "./intake-policy";
import { evaluatePlacementReadiness, type PlacementReadinessFacts } from "./placement-readiness";

const NOW = new Date("2026-09-17T12:00:00Z");
const ORG = "org-1";
const ANIMAL = "animal-1";
const SUBJECT = `animal-profile:${ANIMAL}`;

function record(id: string, kind: string, detail: Record<string, unknown>, over: Partial<PlacementReadinessFacts["careRecords"][number]> = {}) {
  return { id, organizationId: ORG, subjectRef: SUBJECT, kind, lifecycle: "active", effectiveAt: new Date("2026-09-10T00:00:00Z"), detail, ...over };
}

function complete(): PlacementReadinessFacts {
  return {
    animalProfileId: ANIMAL,
    organizationId: ORG,
    now: NOW,
    custody: { id: "ep-1", animalProfileId: ANIMAL, organizationId: ORG, currentStage: "care", legalHoldActive: false, closedAt: null },
    packet: { id: "pk-1", organizationId: ORG, subjectRef: SUBJECT, status: "in-progress", requirementSnapshot: buildAnimalIntakeRequirementSnapshot() },
    openExceptions: [],
    careRecords: [
      record("r-id", "observation", { requirementKey: "identity-check", microchipScanned: true, provider: "Sam" }),
      record("r-exam", "observation", { requirementKey: "intake-examination", provider: "Dr Julia", findings: "healthy" }),
      record("r-weight", "weight", { requirementKey: "weight-condition" }),
      record("r-vax", "vaccination", { requirementKey: "vaccination", product: "DHPP", provider: "Dr Julia" }),
      record("r-para", "medication", { requirementKey: "parasite-treatment", product: "Bravecto", provider: "Dr Julia", outcome: "given" }),
      record("r-ster", "procedure", { requirementKey: "sterilization", provider: "Dr Julia", outcome: "completed", recoveryUntil: "2026-09-15T00:00:00Z" }),
      record("r-beh", "behavior", { requirementKey: "behaviour-assessment", provider: "Sam", outcome: "friendly" }),
    ],
    housing: [{ id: "alloc-1", releasedAt: null }],
    appointments: [],
  };
}

describe("evaluatePlacementReadiness", () => {
  it("is ready only when every fact lines up, and names the supporting records", () => {
    const verdict = evaluatePlacementReadiness(complete());
    expect(verdict.ready).toBe(true);
    expect(verdict.blockers).toEqual([]);
    expect(verdict.satisfied.find((s) => s.requirementKey === "sterilization")?.recordIds).toEqual(["r-ster"]);
    expect(verdict.satisfied.find((s) => s.requirementKey === "housing")?.recordIds).toEqual(["alloc-1"]);
  });

  it("refuses an active hold, an open exception and a closed episode", () => {
    const facts = complete();
    facts.custody = { ...facts.custody!, legalHoldActive: true };
    facts.openExceptions = [{ id: "ex-1", summary: "chip mismatch" }];
    const codes = evaluatePlacementReadiness(facts).blockers.map((b) => b.code);
    expect(codes).toEqual(expect.arrayContaining(["hold_active", "exception_open"]));
    facts.custody = { ...facts.custody!, closedAt: NOW };
    expect(evaluatePlacementReadiness(facts).blockers.map((b) => b.code)).toContain("custody_closed");
  });

  it("names the missing requirement and never treats a legacy boolean as evidence", () => {
    const facts = complete();
    facts.careRecords = facts.careRecords.filter((r) => r.id !== "r-ster");
    facts.careRecords.push(record("r-bool", "note", { spayed: true }));
    const verdict = evaluatePlacementReadiness(facts);
    expect(verdict.ready).toBe(false);
    expect(verdict.blockers).toEqual([{ code: "requirement_missing", requirementKey: "sterilization", message: "Sterilization has no evidence.", recordIds: [] }]);
  });

  it("holds the animal while a procedure recovery window is still running", () => {
    const facts = complete();
    facts.careRecords = facts.careRecords.map((r) => r.id === "r-ster" ? record("r-ster", "procedure", { requirementKey: "sterilization", provider: "Dr Julia", outcome: "completed", recoveryUntil: "2026-09-30T00:00:00Z" }) : r);
    const verdict = evaluatePlacementReadiness(facts);
    expect(verdict.blockers.map((b) => b.code)).toEqual(["recovery_active"]);
  });

  it("refuses a complication that no later record resolved", () => {
    const facts = complete();
    facts.careRecords = facts.careRecords.map((r) => r.id === "r-ster" ? record("r-ster", "procedure", { requirementKey: "sterilization", provider: "Dr Julia", outcome: "complication", complication: "bleeding" }) : r);
    expect(evaluatePlacementReadiness(facts).blockers.map((b) => b.code)).toEqual(["requirement_invalid"]);
  });

  it("ignores superseded records and refuses evidence from another animal", () => {
    const facts = complete();
    facts.careRecords = facts.careRecords.map((r) => r.id === "r-vax" ? { ...r, lifecycle: "superseded" } : r);
    facts.careRecords.push(record("r-other", "vaccination", { requirementKey: "vaccination", product: "x", provider: "y" }, { subjectRef: "animal-profile:someone-else" }));
    const codes = evaluatePlacementReadiness(facts).blockers.map((b) => b.code);
    expect(codes).toEqual(expect.arrayContaining(["subject_mismatch", "requirement_missing"]));
  });

  it("requires exactly one active housing placement and no open appointment footprint", () => {
    const facts = complete();
    facts.housing = [];
    expect(evaluatePlacementReadiness(facts).blockers.map((b) => b.code)).toEqual(["housing_missing"]);
    facts.housing = [{ id: "a", releasedAt: null }, { id: "b", releasedAt: null }];
    expect(evaluatePlacementReadiness(facts).blockers[0]).toMatchObject({ code: "housing_missing", recordIds: ["a", "b"] });
    facts.housing = [{ id: "a", releasedAt: null }];
    facts.appointments = [{ id: "appt-1", status: "booked", footprintEnd: new Date("2026-09-01T00:00:00Z") }];
    expect(evaluatePlacementReadiness(facts).blockers.map((b) => b.code)).toEqual(["appointment_blocking"]);
    facts.appointments = [{ id: "appt-1", status: "completed", footprintEnd: new Date("2026-09-01T00:00:00Z") }];
    expect(evaluatePlacementReadiness(facts).ready).toBe(true);
  });

  it("fails closed when the checklist is missing or unreadable", () => {
    const facts = complete();
    facts.packet = null;
    expect(evaluatePlacementReadiness(facts).blockers.map((b) => b.code)).toEqual(["packet_missing"]);
    facts.packet = { id: "pk", organizationId: ORG, subjectRef: SUBJECT, status: "in-progress", requirementSnapshot: [{ dynamicFormId: "patient" }] };
    expect(evaluatePlacementReadiness(facts).blockers.map((b) => b.code)).toEqual(["requirement_invalid"]);
  });
});
