import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveAccountableApprover, type ApproverRow } from "./approval-routing";
import {
  mayParticipateInHiringDecision,
  mayParticipateInOwnReferralDecision,
  mayRecordReferralObservation,
  referralIsAttributable,
  referralMonitoringRef,
  resolveReferralVesting,
} from "./referral";

const CHAIN: ApproverRow[] = [
  { id: "worker", managerEmployeeId: "lead", status: "active" },
  { id: "lead", managerEmployeeId: "director", status: "active" },
  { id: "director", managerEmployeeId: null, status: "active" },
];

describe("a referrer cannot approve their own referral", () => {
  it("skips the referrer and continues up the chain", () => {
    const routing = resolveAccountableApprover(CHAIN, "worker", ["lead"]);

    expect(routing.resolved).toBe(true);
    if (!routing.resolved) throw new Error("expected resolved");
    expect(routing.approverEmployeeId).toBe("director");
    expect(routing.path[0]).toMatchObject({
      employeeProfileId: "lead",
      skipped: true,
      reason: "referred-this-candidate",
    });
  });

  it("resolves normally when the referrer is not in the chain", () => {
    const routing = resolveAccountableApprover(CHAIN, "worker", ["someone-else"]);

    expect(routing).toMatchObject({ resolved: true, approverEmployeeId: "lead" });
  });

  it("still fails loud when excluding the referrer empties the chain", () => {
    // The exclusion must never silently produce "no approver". Chain-exhausted
    // is the honest answer and it is what the existing walk already reports.
    const routing = resolveAccountableApprover(CHAIN, "worker", ["lead", "director"]);

    expect(routing).toMatchObject({ resolved: false, reason: "chain-exhausted" });
  });

  it("does not treat a conflict as transient — no deputy acts on the referrer's behalf", () => {
    // on-leave is transient and sets onBehalfOf. A conflict of interest is the
    // opposite: this person's judgement is excluded, so nobody acts "for" them.
    const routing = resolveAccountableApprover(CHAIN, "worker", ["lead"]);

    if (!routing.resolved) throw new Error("expected resolved");
    expect(routing.onBehalfOf).toBeNull();
  });

  it("is unconditional", () => {
    expect(mayParticipateInOwnReferralDecision()).toBe(false);
  });
});

describe("attribution is not authority", () => {
  it("attributes a referral by a contingent worker", () => {
    for (const classification of ["contractor_direct", "volunteer", "board_member"] as const) {
      expect(referralIsAttributable(classification)).toBe(true);
    }
  });

  it("still refuses them a seat in the hiring decision", () => {
    for (const classification of ["contractor_direct", "volunteer", "board_member"] as const) {
      expect(mayParticipateInHiringDecision(classification)).toBe(false);
    }
    expect(mayParticipateInHiringDecision("employee")).toBe(true);
  });
});

describe("the bonus is a payroll consequence, never a payment", () => {
  const base = { referralRecordedAt: new Date("2026-01-01"), vestingDays: 90 };

  it("owes nothing while the referral has not been hired", () => {
    expect(
      resolveReferralVesting({ ...base, hireStartedAt: null, now: new Date("2026-06-01") }),
    ).toEqual({ kind: "not-hired" });
  });

  it("stays pending until the tenure milestone", () => {
    const outcome = resolveReferralVesting({
      ...base,
      hireStartedAt: new Date("2026-03-01"),
      now: new Date("2026-04-01"),
    });

    expect(outcome.kind).toBe("pending");
  });

  it("vests exactly on the milestone, not before", () => {
    const hireStartedAt = new Date("2026-03-01T00:00:00.000Z");
    const vestsOn = new Date("2026-05-30T00:00:00.000Z");

    expect(
      resolveReferralVesting({
        ...base,
        hireStartedAt,
        now: new Date(vestsOn.getTime() - 1),
      }).kind,
    ).toBe("pending");

    expect(resolveReferralVesting({ ...base, hireStartedAt, now: vestsOn }).kind).toBe("vested");
  });

  it("takes the clock as an argument so a drifting server cannot vest a bonus", () => {
    const outcome = resolveReferralVesting({
      ...base,
      hireStartedAt: new Date("2026-03-01"),
      now: new Date("2026-03-02"),
    });
    expect(outcome.kind).toBe("pending");
  });
});

describe("monitoring reaches the rail only by opaque ref", () => {
  it("produces an opaque string, not a resolvable identity", () => {
    const ref = referralMonitoringRef("APP-123");

    expect(ref).toBe("referral:APP-123");
    expect(ref).not.toContain("employee");
    expect(ref).not.toContain("candidate");
  });

  it("refuses to collect without a recorded consent basis", () => {
    expect(mayRecordReferralObservation(null)).toBe(false);
    expect(mayRecordReferralObservation("   ")).toBe(false);
    expect(mayRecordReferralObservation("employment-equal-opportunity-monitoring")).toBe(true);
  });
});

describe("structural separation — the guarantee the referral column depends on", () => {
  const schema = readFileSync(
    fileURLToPath(new URL("../../../../packages/db/prisma/schema/workforce.prisma", import.meta.url)),
    "utf8",
  );
  const applicationBlock = (() => {
    const match = /^model Application \{$[\s\S]*?^\}$/m.exec(schema);
    if (!match) throw new Error("model Application not found");
    return match[0];
  })();

  it("records the referring worker", () => {
    expect(applicationBlock).toMatch(/referredByEmployeeProfileId\s+String\?/);
  });

  it("holds NO relation to any scoring model", () => {
    // Referral pipelines reproduce the existing shape of a workforce. If this
    // relationship ever became a scoring input, the platform would be
    // automating exactly the adverse impact ProtectedMonitoringObservation was
    // built to detect. A relation added later "for convenience" destroys that
    // silently — this test is what makes it loud.
    for (const scoringModel of [
      "Scorecard",
      "ProtectedMonitoringObservation",
      "DemographicResponse",
      "CandidateEvaluation",
    ]) {
      expect(applicationBlock).not.toMatch(
        new RegExp(`referredBy\\w*\\s+${scoringModel}`),
      );
    }
    // The referral FK points at EmployeeProfile and nowhere else.
    expect(applicationBlock).toMatch(
      /referredBy\s+EmployeeProfile\?\s+@relation\("ApplicationReferrer"/,
    );
  });

  it("does not cascade a candidate's application away with an employee", () => {
    expect(applicationBlock).toMatch(/ApplicationReferrer[\s\S]*?onDelete: SetNull/);
  });
});
