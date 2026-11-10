import { describe, expect, it } from "vitest";
import {
  assessStatutoryReadiness,
  describeStatutoryReadiness,
  type StatutoryRequirement,
} from "./statutory-readiness";
import type { ResolvableStatutoryRule } from "./statutory-rules";

const ON = new Date("2026-06-15");
const NOW = new Date("2026-06-15");

function rule(over: Partial<ResolvableStatutoryRule> & { id: string }): ResolvableStatutoryRule {
  return {
    taxType: "social_security",
    ruleKind: "rate",
    side: "employee_withheld",
    taxYear: 2026,
    value: 0.5,
    status: "ratified",
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    sourceUrl: "https://authority.example/pub",
    ...over,
  };
}

const REQUIRED: StatutoryRequirement[] = [
  { taxType: "social_security", ruleKind: "rate", side: "employee_withheld", label: "Social Security rate" },
];

/** A jurisdiction verified today, so reference freshness never masks the case under test. */
const FRESH = {
  jurisdictionRefId: "TAX-JUR-US-FEDERAL",
  authorityName: "IRS",
  lastVerifiedAt: new Date("2026-06-14"),
  staleAfterDays: 90,
};

describe("assessStatutoryReadiness", () => {
  it("is ready when every required figure is ratified and the authority is fresh", () => {
    const got = assessStatutoryReadiness(
      { jurisdiction: FRESH, rules: [rule({ id: "ss" })], required: REQUIRED, on: ON },
      NOW,
    );
    expect(got.canComputePayroll).toBe(true);
    expect(got.blockers).toEqual([]);
  });

  it("distinguishes 'never researched' from 'waiting on a human'", () => {
    // These need different actions from a person, so collapsing them into
    // "not ready" would hide that the work is already done.
    const neverResearched = assessStatutoryReadiness(
      { jurisdiction: FRESH, rules: [], required: REQUIRED, on: ON },
      NOW,
    );
    expect(neverResearched.blockers[0]).toMatchObject({
      kind: "missing-figure",
      label: "Social Security rate",
    });

    const waiting = assessStatutoryReadiness(
      { jurisdiction: FRESH, rules: [rule({ id: "ss", status: "proposed" })], required: REQUIRED, on: ON },
      NOW,
    );
    expect(waiting.blockers[0]).toMatchObject({
      kind: "awaiting-ratification",
      label: "Social Security rate",
    });
  });

  it("blocks on an authority nobody has ever verified", () => {
    // The silence this module exists to break: figures can be ratified against
    // a page nobody ever checked.
    const got = assessStatutoryReadiness(
      {
        jurisdiction: { jurisdictionRefId: "J", authorityName: "IRS", lastVerifiedAt: null },
        rules: [rule({ id: "ss" })],
        required: REQUIRED,
        on: ON,
      },
      NOW,
    );
    expect(got.canComputePayroll).toBe(false);
    expect(got.referenceState).toBe("unverified");
    expect(got.blockers).toContainEqual({
      kind: "reference-unverified",
      authorityName: "IRS",
      jurisdictionRefId: "J",
    });
  });

  it("blocks on an authority past its re-check budget", () => {
    const got = assessStatutoryReadiness(
      {
        jurisdiction: {
          jurisdictionRefId: "J",
          authorityName: "IRS",
          lastVerifiedAt: new Date("2026-01-01"),
          staleAfterDays: 90,
        },
        rules: [rule({ id: "ss" })],
        required: REQUIRED,
        on: ON,
      },
      NOW,
    );
    expect(got.referenceState).toBe("stale");
    expect(got.canComputePayroll).toBe(false);
  });

  it("a proposal outside the date window is still 'never researched' for that date", () => {
    const rules = [
      rule({ id: "ss", status: "proposed", effectiveFrom: new Date("2027-01-01") }),
    ];
    const got = assessStatutoryReadiness(
      { jurisdiction: FRESH, rules, required: REQUIRED, on: ON },
      NOW,
    );
    expect(got.blockers[0]).toMatchObject({ kind: "missing-figure" });
  });
});

describe("describeStatutoryReadiness", () => {
  it("says so plainly when everything is confirmed", () => {
    const got = describeStatutoryReadiness({
      canComputePayroll: true,
      blockers: [],
      referenceState: "fresh",
    });
    expect(got).toBe("Every figure this payroll needs is confirmed and current.");
  });

  it("names the count and the next action rather than just 'not ready'", () => {
    const readiness = assessStatutoryReadiness(
      {
        jurisdiction: FRESH,
        rules: [rule({ id: "ss", status: "proposed" })],
        required: [
          ...REQUIRED,
          { taxType: "medicare", ruleKind: "rate", side: "employee_withheld", label: "Medicare rate" },
        ],
        on: ON,
      },
      NOW,
    );
    const got = describeStatutoryReadiness(readiness);
    expect(got).toContain("1 figure has not been researched yet");
    expect(got).toContain("1 researched figure is waiting for someone to confirm it");
  });

  it("mentions an unverified authority in plain words", () => {
    const got = describeStatutoryReadiness({
      canComputePayroll: false,
      blockers: [{ kind: "reference-unverified", authorityName: "IRS", jurisdictionRefId: "J" }],
      referenceState: "unverified",
    });
    expect(got).toContain("never been checked against its own website");
  });
});
