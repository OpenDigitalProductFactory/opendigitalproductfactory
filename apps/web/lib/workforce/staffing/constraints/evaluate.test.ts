import { describe, expect, it } from "vitest";
import { evaluateConstraints } from "./evaluate";
import type {
  ConstraintRuleInput,
  NormalizedStaffingProblem,
} from "./types";
import { resolveStarterPack } from "../rule-packs/us";

// EP-WORKFORCE-OPS / BI-4AD09A35 Phase 2 — constraint goldens. Every predicate
// carries a passing and a violating fixture (spec §17.2).

function zi(at: string) {
  return { at, timezone: "America/Los_Angeles" };
}

function baseProblem(
  partial: Partial<NormalizedStaffingProblem> = {},
): NormalizedStaffingProblem {
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

const HARD = (predicateType: string, parameters: Record<string, unknown> = {}): ConstraintRuleInput => ({
  ruleId: `r-${predicateType}`,
  predicateType,
  severity: "hard",
  legallyWaivable: false,
  parameters,
});

describe("credential_eligibility", () => {
  const shift = {
    shiftId: "s1",
    interval: { start: zi("2026-08-01T16:00:00Z"), end: zi("2026-08-01T20:00:00Z") },
    workLocationId: null,
    requiredCredentials: ["rbs_alcohol"],
  };
  const assignment = { assignmentId: "a1", shiftId: "s1", employeeProfileId: "e1", lifecycle: "confirmed" };

  it("passes when the assignee holds a valid, unexpired credential", () => {
    const r = evaluateConstraints(
      baseProblem({
        shifts: [shift],
        assignments: [assignment],
        employees: [{ employeeProfileId: "e1", credentials: [{ key: "rbs_alcohol", expiresAt: "2027-01-01T00:00:00Z" }], capabilities: [], roleKey: null, employmentType: null }],
        rules: [HARD("credential_eligibility")],
      }),
    );
    expect(r.feasible).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it("fails when the credential is expired at shift start", () => {
    const r = evaluateConstraints(
      baseProblem({
        shifts: [shift],
        assignments: [assignment],
        employees: [{ employeeProfileId: "e1", credentials: [{ key: "rbs_alcohol", expiresAt: "2026-01-01T00:00:00Z" }], capabilities: [], roleKey: null, employmentType: null }],
        rules: [HARD("credential_eligibility")],
      }),
    );
    expect(r.feasible).toBe(false);
    expect(r.violations[0].predicateType).toBe("credential_eligibility");
  });
});

describe("capability_presence", () => {
  const shift = { shiftId: "s1", interval: { start: zi("2026-08-01T16:00:00Z"), end: zi("2026-08-01T20:00:00Z") }, workLocationId: null, requiredCredentials: [] };
  const rule = HARD("capability_presence", { capability: "dea_keyholder" });

  it("passes when a capability holder is present", () => {
    const r = evaluateConstraints(baseProblem({
      shifts: [shift],
      assignments: [{ assignmentId: "a1", shiftId: "s1", employeeProfileId: "e1", lifecycle: "confirmed" }],
      employees: [{ employeeProfileId: "e1", credentials: [], capabilities: ["dea_keyholder"], roleKey: null, employmentType: null }],
      rules: [rule],
    }));
    expect(r.feasible).toBe(true);
  });

  it("fails when a staffed shift has no capability holder", () => {
    const r = evaluateConstraints(baseProblem({
      shifts: [shift],
      assignments: [{ assignmentId: "a1", shiftId: "s1", employeeProfileId: "e1", lifecycle: "confirmed" }],
      employees: [{ employeeProfileId: "e1", credentials: [], capabilities: [], roleKey: null, employmentType: null }],
      rules: [rule],
    }));
    expect(r.feasible).toBe(false);
  });
});

describe("min_n_together (dual control)", () => {
  const shift = { shiftId: "s1", interval: { start: zi("2026-08-01T16:00:00Z"), end: zi("2026-08-01T20:00:00Z") }, workLocationId: null, requiredCredentials: [] };
  const rule = HARD("min_n_together", { capability: "vault_authorized", n: 2 });
  const emp = (id: string, caps: string[]) => ({ employeeProfileId: id, credentials: [], capabilities: caps, roleKey: null, employmentType: null });

  it("passes with two authorized present", () => {
    const r = evaluateConstraints(baseProblem({
      shifts: [shift],
      assignments: [
        { assignmentId: "a1", shiftId: "s1", employeeProfileId: "e1", lifecycle: "confirmed" },
        { assignmentId: "a2", shiftId: "s1", employeeProfileId: "e2", lifecycle: "confirmed" },
      ],
      employees: [emp("e1", ["vault_authorized"]), emp("e2", ["vault_authorized"])],
      rules: [rule],
    }));
    expect(r.feasible).toBe(true);
  });

  it("fails with only one authorized present", () => {
    const r = evaluateConstraints(baseProblem({
      shifts: [shift],
      assignments: [
        { assignmentId: "a1", shiftId: "s1", employeeProfileId: "e1", lifecycle: "confirmed" },
        { assignmentId: "a2", shiftId: "s1", employeeProfileId: "e2", lifecycle: "confirmed" },
      ],
      employees: [emp("e1", ["vault_authorized"]), emp("e2", [])],
      rules: [rule],
    }));
    expect(r.feasible).toBe(false);
  });
});

describe("pairing_ratio (apprentice:journeyman)", () => {
  const shift = { shiftId: "s1", interval: { start: zi("2026-08-01T16:00:00Z"), end: zi("2026-08-01T20:00:00Z") }, workLocationId: null, requiredCredentials: [] };
  const rule = HARD("pairing_ratio", { supervisedRole: "apprentice", supervisorRole: "journeyman", maxPerSupervisor: 1 });
  const emp = (id: string, role: string) => ({ employeeProfileId: id, credentials: [], capabilities: [], roleKey: role, employmentType: null });
  const assign = (id: string, emp: string) => ({ assignmentId: id, shiftId: "s1", employeeProfileId: emp, lifecycle: "confirmed" });

  it("passes at 1 apprentice per journeyman", () => {
    const r = evaluateConstraints(baseProblem({
      shifts: [shift],
      assignments: [assign("a1", "e1"), assign("a2", "e2")],
      employees: [emp("e1", "journeyman"), emp("e2", "apprentice")],
      rules: [rule],
    }));
    expect(r.feasible).toBe(true);
  });

  it("fails at 2 apprentices per journeyman", () => {
    const r = evaluateConstraints(baseProblem({
      shifts: [shift],
      assignments: [assign("a1", "e1"), assign("a2", "e2"), assign("a3", "e3")],
      employees: [emp("e1", "journeyman"), emp("e2", "apprentice"), emp("e3", "apprentice")],
      rules: [rule],
    }));
    expect(r.feasible).toBe(false);
  });
});

describe("rest_gap and no_overlap", () => {
  const emp = { employeeProfileId: "e1", credentials: [], capabilities: [], roleKey: null, employmentType: null };
  const shiftA = { shiftId: "s1", interval: { start: zi("2026-08-01T00:00:00Z"), end: zi("2026-08-01T08:00:00Z") }, workLocationId: null, requiredCredentials: [] };

  it("rest_gap passes with a 12h gap, fails with a 4h gap", () => {
    const near = { shiftId: "s2", interval: { start: zi("2026-08-01T12:00:00Z"), end: zi("2026-08-01T20:00:00Z") }, workLocationId: null, requiredCredentials: [] };
    const far = { shiftId: "s2", interval: { start: zi("2026-08-01T20:00:00Z"), end: zi("2026-08-02T04:00:00Z") }, workLocationId: null, requiredCredentials: [] };
    const assigns = [
      { assignmentId: "a1", shiftId: "s1", employeeProfileId: "e1", lifecycle: "confirmed" },
      { assignmentId: "a2", shiftId: "s2", employeeProfileId: "e1", lifecycle: "confirmed" },
    ];
    const rule = HARD("rest_gap", { minHours: 10 });
    expect(evaluateConstraints(baseProblem({ shifts: [shiftA, far], assignments: assigns, employees: [emp], rules: [rule] })).feasible).toBe(true);
    expect(evaluateConstraints(baseProblem({ shifts: [shiftA, near], assignments: assigns, employees: [emp], rules: [rule] })).feasible).toBe(false);
  });

  it("no_overlap fails on overlapping confirmed assignments", () => {
    const overlap = { shiftId: "s2", interval: { start: zi("2026-08-01T04:00:00Z"), end: zi("2026-08-01T12:00:00Z") }, workLocationId: null, requiredCredentials: [] };
    const r = evaluateConstraints(baseProblem({
      shifts: [shiftA, overlap],
      assignments: [
        { assignmentId: "a1", shiftId: "s1", employeeProfileId: "e1", lifecycle: "confirmed" },
        { assignmentId: "a2", shiftId: "s2", employeeProfileId: "e1", lifecycle: "confirmed" },
      ],
      employees: [emp],
      rules: [HARD("no_overlap")],
    }));
    expect(r.feasible).toBe(false);
  });
});

describe("max_hours_premium (priced, not infeasible)", () => {
  it("adds a premium for hours over threshold without breaking feasibility", () => {
    const shift = { shiftId: "s1", interval: { start: zi("2026-08-01T00:00:00Z"), end: zi("2026-08-01T10:00:00Z") }, workLocationId: null, requiredCredentials: [] };
    const r = evaluateConstraints(baseProblem({
      shifts: [shift],
      assignments: [{ assignmentId: "a1", shiftId: "s1", employeeProfileId: "e1", lifecycle: "confirmed" }],
      employees: [{ employeeProfileId: "e1", credentials: [], capabilities: [], roleKey: null, employmentType: null }],
      rules: [{ ruleId: "ot", predicateType: "max_hours_premium", severity: "soft", legallyWaivable: false, parameters: { thresholdHours: 8, premiumPerHour: 0.5 } }],
    }));
    expect(r.feasible).toBe(true);
    expect(r.premiums).toHaveLength(1);
    expect(r.premiums[0].units).toBeCloseTo(1); // (10 - 8) * 0.5
  });
});

describe("clopening_premium (soft, priced) vs rest_gap (hard)", () => {
  const emp = { employeeProfileId: "e1", credentials: [], capabilities: [], roleKey: null, employmentType: null };
  const shiftA = { shiftId: "s1", interval: { start: zi("2026-08-01T00:00:00Z"), end: zi("2026-08-01T08:00:00Z") }, workLocationId: null, requiredCredentials: [] };
  const near = { shiftId: "s2", interval: { start: zi("2026-08-01T14:00:00Z"), end: zi("2026-08-01T22:00:00Z") }, workLocationId: null, requiredCredentials: [] };
  const assigns = [
    { assignmentId: "a1", shiftId: "s1", employeeProfileId: "e1", lifecycle: "confirmed" },
    { assignmentId: "a2", shiftId: "s2", employeeProfileId: "e1", lifecycle: "confirmed" },
  ];

  it("prices a short turnaround as a premium without breaking feasibility", () => {
    const r = evaluateConstraints(baseProblem({
      shifts: [shiftA, near], assignments: assigns, employees: [emp],
      rules: [{ ruleId: "clop", predicateType: "clopening_premium", severity: "soft", legallyWaivable: false, parameters: { minHours: 11, premiumUnits: 1 } }],
    }));
    expect(r.feasible).toBe(true); // 6h turnaround < 11h — priced, not infeasible
    expect(r.premiums).toHaveLength(1);
  });
});

describe("max_consecutive_days (hard, fatigue)", () => {
  const emp = { employeeProfileId: "e1", credentials: [], capabilities: [], roleKey: null, employmentType: null };
  const day = (n: number) => ({ shiftId: `s${n}`, interval: { start: zi(`2026-08-0${n}T09:00:00Z`), end: zi(`2026-08-0${n}T17:00:00Z`) }, workLocationId: null, requiredCredentials: [] });
  const assign = (n: number) => ({ assignmentId: `a${n}`, shiftId: `s${n}`, employeeProfileId: "e1", lifecycle: "confirmed" });
  const rule = HARD("max_consecutive_days", { maxDays: 6 });

  it("passes at 6 consecutive days, fails at 7", () => {
    const six = evaluateConstraints(baseProblem({ shifts: [1,2,3,4,5,6].map(day), assignments: [1,2,3,4,5,6].map(assign), employees: [emp], rules: [rule] }));
    expect(six.feasible).toBe(true);
    const seven = evaluateConstraints(baseProblem({ shifts: [1,2,3,4,5,6,7].map(day), assignments: [1,2,3,4,5,6,7].map(assign), employees: [emp], rules: [rule] }));
    expect(seven.feasible).toBe(false);
  });
});

describe("fail-closed jurisdiction (spec §6, §8.1)", () => {
  it("requires policy review when jurisdiction is unresolved and a safety-critical rule is in scope", () => {
    const r = evaluateConstraints(baseProblem({
      jurisdiction: { country: null, region: null, resolved: false },
      rules: [HARD("credential_eligibility")],
    }));
    expect(r.requiresPolicyReview).toBe(true);
    expect(r.feasible).toBe(false);
  });

  it("treats an unknown hard predicate as review-required, not silently feasible", () => {
    const r = evaluateConstraints(baseProblem({
      rules: [HARD("some_unimplemented_family")],
    }));
    expect(r.requiresPolicyReview).toBe(true);
    expect(r.feasible).toBe(false);
  });
});

describe("resolveStarterPack", () => {
  it("returns federal + CA for US-CA, federal for other US, null otherwise", () => {
    expect(resolveStarterPack("US-CA")?.some((r) => r.ruleId === "us-ca-daily-overtime")).toBe(true);
    expect(resolveStarterPack("US-NV")?.every((r) => r.ruleId.startsWith("us-flsa") || r.ruleId.startsWith("us-no"))).toBe(true);
    expect(resolveStarterPack(null)).toBeNull();
    expect(resolveStarterPack("GB")).toBeNull();
  });
});
