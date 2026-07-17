import { describe, expect, it } from "vitest";
import { MockGreedySolver } from "./mock-adapter";
import { validateSolverResult, validateSolverOption } from "./validate-after-solve";
import type { NormalizedStaffingProblem } from "../constraints/types";
import type { SolverOption } from "./adapter";

// EP-WORKFORCE-OPS / BI-4AD09A35 Phase 3 — solver adapter contract + the
// independent post-solve validation gate (spec §7.3).

function zi(at: string) {
  return { at, timezone: "America/Los_Angeles" };
}

function problem(partial: Partial<NormalizedStaffingProblem> = {}): NormalizedStaffingProblem {
  return {
    organizationId: "org-1",
    jurisdiction: { country: "US", region: "US-CA", resolved: true },
    employees: [],
    shifts: [],
    assignments: [],
    rules: [],
    ...partial,
  };
}

const shift = (id: string, start: string, end: string, req: string[] = []) => ({
  shiftId: id,
  interval: { start: zi(start), end: zi(end) },
  workLocationId: null,
  requiredCredentials: req,
});
const emp = (id: string, creds: Array<{ key: string; expiresAt: string | null }> = []) => ({
  employeeProfileId: id,
  credentials: creds,
  capabilities: [],
  roleKey: null,
  employmentType: null,
});

describe("MockGreedySolver", () => {
  it("is deterministic — same input yields the same output", async () => {
    const p = problem({
      shifts: [shift("s2", "2026-08-01T16:00:00Z", "2026-08-01T20:00:00Z"), shift("s1", "2026-08-01T08:00:00Z", "2026-08-01T12:00:00Z")],
      employees: [emp("e2"), emp("e1")],
    });
    const solver = new MockGreedySolver();
    const a = await solver.solve(p);
    const b = await solver.solve(p);
    expect(a).toEqual(b);
    expect(a.status).toBe("feasible");
  });

  it("returns an honest 'infeasible' with unfilled shifts rather than fabricating a fill", async () => {
    // Two concurrent shifts, one employee — the second cannot be filled.
    const p = problem({
      shifts: [
        shift("s1", "2026-08-01T08:00:00Z", "2026-08-01T12:00:00Z"),
        shift("s2", "2026-08-01T08:00:00Z", "2026-08-01T12:00:00Z"),
      ],
      employees: [emp("e1")],
    });
    const result = await new MockGreedySolver().solve(p);
    expect(result.status).toBe("infeasible");
    expect(result.options[0].unfilledShiftIds).toEqual(["s2"]);
    expect(result.options[0].assignments).toHaveLength(1);
  });

  it("respects credential eligibility when filling", async () => {
    const p = problem({
      shifts: [shift("s1", "2026-08-01T08:00:00Z", "2026-08-01T12:00:00Z", ["rbs_alcohol"])],
      employees: [emp("e1"), emp("e2", [{ key: "rbs_alcohol", expiresAt: "2027-01-01T00:00:00Z" }])],
    });
    const result = await new MockGreedySolver().solve(p);
    expect(result.options[0].assignments).toEqual([{ shiftId: "s1", employeeProfileId: "e2" }]);
  });
});

describe("validate-after-solve (spec §7.3 — solver is untrusted)", () => {
  it("certifies a clean option as publishable", async () => {
    const p = problem({
      shifts: [shift("s1", "2026-08-01T08:00:00Z", "2026-08-01T12:00:00Z")],
      employees: [emp("e1")],
      rules: [{ ruleId: "no-overlap", predicateType: "no_overlap", severity: "hard", legallyWaivable: false, parameters: {} }],
    });
    const result = await new MockGreedySolver().solve(p);
    const validated = validateSolverResult(p, result.options);
    expect(validated[0].publishable).toBe(true);
    expect(validated[0].evaluation.feasible).toBe(true);
  });

  it("rejects a solver option that violates a hard rule the solver ignored", () => {
    // A malicious/buggy solver double-books e1 across two overlapping shifts.
    const p = problem({
      shifts: [
        shift("s1", "2026-08-01T08:00:00Z", "2026-08-01T12:00:00Z"),
        shift("s2", "2026-08-01T10:00:00Z", "2026-08-01T14:00:00Z"),
      ],
      employees: [emp("e1")],
      rules: [{ ruleId: "no-overlap", predicateType: "no_overlap", severity: "hard", legallyWaivable: false, parameters: {} }],
    });
    const rogueOption: SolverOption = {
      assignments: [
        { shiftId: "s1", employeeProfileId: "e1" },
        { shiftId: "s2", employeeProfileId: "e1" },
      ],
      score: 2,
      unfilledShiftIds: [],
      hardViolationCount: 0, // the solver claims zero — DPF must not trust that
    };
    const validated = validateSolverOption(p, rogueOption);
    expect(validated.publishable).toBe(false);
    expect(validated.evaluation.feasible).toBe(false);
    expect(validated.evaluation.violations[0].predicateType).toBe("no_overlap");
  });

  it("withholds publish when the jurisdiction is unresolved (fail-closed)", () => {
    const p = problem({
      jurisdiction: { country: null, region: null, resolved: false },
      shifts: [shift("s1", "2026-08-01T08:00:00Z", "2026-08-01T12:00:00Z", ["license"])],
      employees: [emp("e1", [{ key: "license", expiresAt: null }])],
      rules: [{ ruleId: "cred", predicateType: "credential_eligibility", severity: "hard", legallyWaivable: false, parameters: {} }],
    });
    const validated = validateSolverOption(p, {
      assignments: [{ shiftId: "s1", employeeProfileId: "e1" }],
      score: 1,
      unfilledShiftIds: [],
      hardViolationCount: 0,
    });
    expect(validated.publishable).toBe(false);
    expect(validated.evaluation.requiresPolicyReview).toBe(true);
  });
});
