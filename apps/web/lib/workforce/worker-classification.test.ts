import { describe, expect, it } from "vitest";

import {
  consequencesFor,
  engagementTermDrift,
  resolveClassification,
  type WorkerClassificationConsequences,
} from "./worker-classification";

const ALL = [
  "employee",
  "contractor_direct",
  "contractor_agency",
  "temp_agency_worker",
  "eor_employee",
  "volunteer",
  "intern",
  "board_member",
] as const;

describe("worker classification consequences", () => {
  it("answers every consequence for every classification", () => {
    const keys: (keyof WorkerClassificationConsequences)[] = [
      "payrollWithholding",
      "directable",
      "accruesLeaveAndBenefits",
      "entersReviewCycles",
      "orgChartPlacement",
      "expectsDefiniteTerm",
      "employedByThirdParty",
    ];
    for (const classification of ALL) {
      const c = consequencesFor(classification);
      for (const key of keys) expect(c[key]).toBeDefined();
    }
  });

  // The load-bearing flag. Directing a worker the organisation may not direct is
  // the behavioural-control factor behind joint-employer findings, so this pins
  // exactly which classes are directable — a change here is a legal change.
  it("permits direction only for employee, EOR employee and intern", () => {
    const directable = ALL.filter((c) => consequencesFor(c).directable);
    expect(directable).toEqual(["employee", "eor_employee", "intern"]);
  });

  it("keeps a volunteer undirectable and unpaid", () => {
    const volunteer = consequencesFor("volunteer");
    expect(volunteer.directable).toBe(false);
    expect(volunteer.payrollWithholding).toBe(false);
    expect(volunteer.accruesLeaveAndBenefits).toBe(false);
    expect(volunteer.entersReviewCycles).toBe(false);
    expect(volunteer.orgChartPlacement).toBe("engaged-party");
  });

  it("places every undirectable worker as an engaged party, not a reporting line", () => {
    for (const classification of ALL) {
      const c = consequencesFor(classification);
      if (!c.directable) expect(c.orgChartPlacement).toBe("engaged-party");
    }
  });

  it("names the classes employed by a third party", () => {
    const thirdParty = ALL.filter((c) => consequencesFor(c).employedByThirdParty);
    expect(thirdParty).toEqual(["contractor_agency", "temp_agency_worker", "eor_employee"]);
  });

  it("withholds payroll only where this organisation is the payer", () => {
    const withholding = ALL.filter((c) => consequencesFor(c).payrollWithholding);
    expect(withholding).toEqual(["employee", "intern"]);
    // An EOR arrangement is directable but the EOR withholds, so directable and
    // withholding are genuinely independent axes rather than one flag.
    const eor = consequencesFor("eor_employee");
    expect(eor.directable).toBe(true);
    expect(eor.payrollWithholding).toBe(false);
  });
});

describe("resolveClassification", () => {
  it("resolves a determined classification", () => {
    expect(resolveClassification({ employmentType: { classification: "volunteer" } }))
      .toEqual({ resolved: true, classification: "volunteer" });
  });

  // Fails loud rather than defaulting. A silent default would be a confidently
  // wrong legal claim, and every permissive default errs toward directing
  // someone the organisation may not direct.
  it("reports no employment type rather than defaulting", () => {
    expect(resolveClassification({ employmentType: null }))
      .toEqual({ resolved: false, reason: "no-employment-type" });
    expect(resolveClassification({}))
      .toEqual({ resolved: false, reason: "no-employment-type" });
  });

  it("reports an unclassified employment type rather than defaulting", () => {
    expect(resolveClassification({ employmentType: { classification: null } }))
      .toEqual({ resolved: false, reason: "employment-type-unclassified" });
  });

  it("never resolves to employee without a recorded determination", () => {
    for (const worker of [
      { employmentType: null },
      { employmentType: { classification: null } },
      {},
    ]) {
      const result = resolveClassification(worker);
      expect(result.resolved).toBe(false);
    }
  });
});

describe("engagementTermDrift", () => {
  const now = new Date("2026-08-26T00:00:00.000Z");

  it("ignores classes that do not expect a definite term", () => {
    expect(engagementTermDrift("employee", null, now)).toEqual({ drifted: false });
    expect(engagementTermDrift("volunteer", null, now)).toEqual({ drifted: false });
  });

  it("flags a contingent engagement with no recorded term", () => {
    expect(engagementTermDrift("contractor_direct", null, now))
      .toEqual({ drifted: true, reason: "missing-term" });
  });

  it("flags a lapsed term still running", () => {
    expect(engagementTermDrift(
      "contractor_direct",
      { endsOn: new Date("2026-08-01T00:00:00.000Z"), supersededAt: null },
      now,
    )).toEqual({ drifted: true, reason: "term-lapsed" });
  });

  it("accepts a term still within its agreed end", () => {
    expect(engagementTermDrift(
      "contractor_direct",
      { endsOn: new Date("2026-12-01T00:00:00.000Z"), supersededAt: null },
      now,
    )).toEqual({ drifted: false });
  });

  // An extension supersedes the prior term. The superseded row is history, not
  // drift — the successor carries the current agreed end.
  it("does not flag a superseded term", () => {
    expect(engagementTermDrift(
      "contractor_direct",
      { endsOn: new Date("2026-08-01T00:00:00.000Z"), supersededAt: new Date("2026-07-30T00:00:00.000Z") },
      now,
    )).toEqual({ drifted: false });
  });
});
