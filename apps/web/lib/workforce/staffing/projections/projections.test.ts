import { describe, expect, it } from "vitest";
import { projectAssignmentsToCalendar, type ProjectableAssignment } from "./assignment-to-calendar";
import { applyEmployeeReview, type CandidateFact } from "./candidate-fact-flow";

// EP-WORKFORCE-OPS / BI-4AD09A35 Phase 7 — calendar projection + the
// "a message is not leave" candidate-fact flow (spec §2.2, §5.2, §10, §11).

function assignment(id: string, lifecycle: string): ProjectableAssignment {
  return {
    assignmentId: id,
    employeeProfileId: "e1",
    lifecycle,
    shift: {
      shiftId: `s-${id}`,
      startAt: "2026-08-01T16:00:00Z",
      endAt: "2026-08-01T20:00:00Z",
      timezone: "America/Los_Angeles",
      roleLabel: "Front desk",
      workLocationId: "loc-A",
    },
  };
}

describe("projectAssignmentsToCalendar", () => {
  it("projects only confirmed/published assignments, marked read-only", () => {
    const rows = projectAssignmentsToCalendar([
      assignment("a1", "confirmed"),
      assignment("a2", "proposed"),
      assignment("a3", "published"),
      assignment("a4", "withdrawn"),
    ]);
    expect(rows.map((r) => r.sourceRef)).toEqual([
      "staffing-assignment:a1",
      "staffing-assignment:a3",
    ]);
    expect(rows.every((r) => r.readonly === true && r.category === "staffing")).toBe(true);
  });

  it("uses a stable idempotency key per source assignment", () => {
    const once = projectAssignmentsToCalendar([assignment("a1", "confirmed")]);
    const twice = projectAssignmentsToCalendar([assignment("a1", "confirmed")]);
    expect(once[0].sourceRef).toBe(twice[0].sourceRef);
  });
});

describe("candidate-fact flow — a message is not leave (spec §2.2)", () => {
  function fact(overrides: Partial<CandidateFact> = {}): CandidateFact {
    return {
      candidateFactId: "cf1",
      subjectEmployeeProfileId: "e1",
      kind: "time_off_intent",
      reviewState: "pending",
      extractedValue: { startDate: "2026-08-10", endDate: "2026-08-12", leaveType: "vacation" },
      identityResolution: "resolved",
      confidence: 0.9,
      ...overrides,
    };
  }

  it("promotes a confirmed intent only to a PENDING leave request, never approved", () => {
    const result = applyEmployeeReview(fact(), { action: "confirm" });
    expect(result.outcome).toBe("promoted");
    if (result.outcome === "promoted") {
      expect(result.draft.status).toBe("pending");
      expect(result.draft.sourceCandidateFactId).toBe("cf1");
      expect(result.draft.startDate).toBe("2026-08-10");
    }
  });

  it("never promotes when identity is unresolved or ambiguous", () => {
    expect(applyEmployeeReview(fact({ identityResolution: "ambiguous" }), { action: "confirm" }).outcome).toBe("blocked");
    expect(applyEmployeeReview(fact({ subjectEmployeeProfileId: null, identityResolution: "unresolved" }), { action: "confirm" }).outcome).toBe("blocked");
  });

  it("never promotes a non-time-off candidate fact", () => {
    expect(applyEmployeeReview(fact({ kind: "availability_hint" }), { action: "confirm" }).outcome).toBe("blocked");
  });

  it("rejects on employee reject, producing no leave draft", () => {
    const result = applyEmployeeReview(fact(), { action: "reject" });
    expect(result.outcome).toBe("rejected");
  });

  it("honors an employee edit of the dates", () => {
    const result = applyEmployeeReview(fact({ extractedValue: null }), {
      action: "edit",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      leaveType: "personal",
    });
    expect(result.outcome).toBe("promoted");
    if (result.outcome === "promoted") {
      expect(result.draft.startDate).toBe("2026-09-01");
      expect(result.draft.leaveType).toBe("personal");
    }
  });

  it("blocks an inverted or incomplete date range", () => {
    expect(applyEmployeeReview(fact({ extractedValue: { startDate: "2026-08-12", endDate: "2026-08-10" } }), { action: "confirm" }).outcome).toBe("blocked");
    expect(applyEmployeeReview(fact({ extractedValue: { startDate: "2026-08-10" } }), { action: "confirm" }).outcome).toBe("blocked");
  });
});
