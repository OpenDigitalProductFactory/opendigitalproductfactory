import { describe, expect, it } from "vitest";

import {
  DEFAULT_HORIZON_DAYS,
  cadenceToDays,
  sweepDeadlineHorizon,
  type DeadlineHorizonInput,
} from "./deadline-horizon-sweep";

const NOW = new Date("2026-08-21T00:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const empty: DeadlineHorizonInput = {
  now: NOW,
  obligations: [],
  controls: [],
  licenseReferences: [],
};

const obligation = (over: Partial<DeadlineHorizonInput["obligations"][number]> = {}) => ({
  obligationId: "OBL-1",
  title: "File the annual return",
  frequency: "annual" as string | null,
  reviewDate: null as Date | null,
  status: "active",
  ...over,
});

const control = (over: Partial<DeadlineHorizonInput["controls"][number]> = {}) => ({
  controlId: "CTL-1",
  title: "Access review",
  reviewFrequency: "quarterly" as string | null,
  lastReviewedAt: null as Date | null,
  nextReviewDate: null as Date | null,
  status: "active",
  ...over,
});

const licenseRef = (over: Partial<DeadlineHorizonInput["licenseReferences"][number]> = {}) => ({
  requirementRefId: "LRR-1",
  jurisdictionLabel: "Texas",
  requirementType: "business-registration",
  staleAfterDays: 180,
  renewalCadenceHint: "annual",
  lastVerifiedAt: null as Date | null,
  ...over,
});

describe("cadenceToDays", () => {
  it("maps the recurrence words the compliance surfaces write", () => {
    expect(cadenceToDays("annual")).toBe(365);
    expect(cadenceToDays("Quarterly")).toBe(91);
    expect(cadenceToDays(" monthly ")).toBe(30);
  });

  it("does not guess at text it does not recognise", () => {
    expect(cadenceToDays("when the auditor asks")).toBeNull();
    expect(cadenceToDays(null)).toBeNull();
  });
});

describe("an empty substrate", () => {
  it("is a FAILURE stop, not a clean sweep", () => {
    const result = sweepDeadlineHorizon(empty);
    expect(result.findings).toEqual([]);
    expect(result.stoppedBy?.kind).toBe("failure");
  });
});

describe("Obligation.reviewDate + Obligation.frequency", () => {
  it("raises a finding for a real due date inside the horizon", () => {
    const result = sweepDeadlineHorizon({
      ...empty,
      obligations: [obligation({ reviewDate: days(10) })],
    });
    expect(result.stoppedBy).toBeNull();
    expect(result.findings).toHaveLength(1);
    const [found] = result.findings;
    expect(found.title).toBe("Due: File the annual return");
    expect(found.policySeverity).toBe("medium");
    expect(found.evidence.source).toBe("Obligation.reviewDate");
    expect(found.evidence.reviewDate).toBe(days(10).toISOString());
    expect(found.description).toContain("in 10 days");
    // The recurrence is used to propose the NEXT date, not invented.
    expect(found.remediationHint.nextReviewDate).toBe(days(375).toISOString());
  });

  it("escalates an overdue obligation to high", () => {
    const result = sweepDeadlineHorizon({
      ...empty,
      obligations: [obligation({ reviewDate: days(-5) })],
    });
    expect(result.findings[0].policySeverity).toBe("high");
    expect(result.findings[0].title).toMatch(/^Overdue:/);
    expect(result.findings[0].description).toContain("5 days ago");
  });

  it("stays silent about a date beyond the horizon", () => {
    const result = sweepDeadlineHorizon({
      ...empty,
      obligations: [obligation({ reviewDate: days(DEFAULT_HORIZON_DAYS + 1) })],
      controls: [control({ reviewFrequency: null })],
    });
    expect(result.findings).toEqual([]);
  });

  it("treats a declared recurrence with no next date as the defect it is", () => {
    const result = sweepDeadlineHorizon({ ...empty, obligations: [obligation()] });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence.source).toBe("Obligation.frequency");
    expect(result.findings[0].evidence.reason).toBe("recurrence-with-no-next-date");
    expect(result.findings[0].description).toContain("reads as a control in force and is not");
  });

  it("ignores an inactive obligation", () => {
    const result = sweepDeadlineHorizon({
      ...empty,
      obligations: [obligation({ reviewDate: days(1), status: "retired" })],
      controls: [control({ reviewFrequency: null })],
    });
    expect(result.findings).toEqual([]);
  });
});

describe("Control.nextReviewDate / lastReviewedAt / reviewFrequency", () => {
  it("reads nextReviewDate when it is recorded", () => {
    const result = sweepDeadlineHorizon({
      ...empty,
      controls: [control({ nextReviewDate: days(3) })],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence.source).toBe("Control.nextReviewDate");
    expect(result.findings[0].evidence.dueAt).toBe(days(3).toISOString());
  });

  it("derives the due date from lastReviewedAt + reviewFrequency when there is no next date", () => {
    // Reviewed 80 days ago on a quarterly (91-day) cadence → due in 11 days.
    const result = sweepDeadlineHorizon({
      ...empty,
      controls: [control({ lastReviewedAt: days(-80) })],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence.source).toBe(
      "Control.lastReviewedAt + Control.reviewFrequency",
    );
    expect(result.findings[0].evidence.dueAt).toBe(days(11).toISOString());
  });

  it("flags a control that declares a cadence and has never been reviewed", () => {
    const result = sweepDeadlineHorizon({ ...empty, controls: [control()] });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence.source).toBe("Control.reviewFrequency");
  });

  it("says nothing about a control with no cadence and no dates", () => {
    const result = sweepDeadlineHorizon({
      ...empty,
      controls: [control({ reviewFrequency: null })],
      obligations: [obligation({ frequency: null })],
    });
    expect(result.findings).toEqual([]);
  });
});

describe("LicenseRequirementReference.staleAfterDays / renewalCadenceHint", () => {
  it("spends the freshness budget from lastVerifiedAt", () => {
    // Verified 170 days ago on a 180-day budget → stale in 10 days.
    const result = sweepDeadlineHorizon({
      ...empty,
      licenseReferences: [licenseRef({ lastVerifiedAt: days(-170) })],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence.source).toBe(
      "LicenseRequirementReference.staleAfterDays",
    );
    expect(result.findings[0].evidence.staleAt).toBe(days(10).toISOString());
    expect(result.findings[0].remediationHint.renewalCadenceHint).toBe("annual");
  });

  it("treats a never-verified requirement as already stale", () => {
    const result = sweepDeadlineHorizon({ ...empty, licenseReferences: [licenseRef()] });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].description).toContain("never been verified");
  });

  it("stays silent while the budget still has room", () => {
    const result = sweepDeadlineHorizon({
      ...empty,
      licenseReferences: [licenseRef({ lastVerifiedAt: days(-10) })],
    });
    expect(result.findings).toEqual([]);
  });
});

describe("finding identity", () => {
  it("is stable across runs for the same due date, so a finding reopens rather than duplicating", () => {
    const input = { ...empty, obligations: [obligation({ reviewDate: days(10) })] };
    const first = sweepDeadlineHorizon(input);
    const second = sweepDeadlineHorizon({ ...input, now: new Date(NOW.getTime() + 3_600_000) });
    expect(second.findings[0].findingKey).toBe(first.findings[0].findingKey);
  });

  it("changes when the due date changes, so a rescheduled review is a new finding", () => {
    const a = sweepDeadlineHorizon({ ...empty, obligations: [obligation({ reviewDate: days(10) })] });
    const b = sweepDeadlineHorizon({ ...empty, obligations: [obligation({ reviewDate: days(11) })] });
    expect(b.findings[0].findingKey).not.toBe(a.findings[0].findingKey);
  });
});

describe("the declared budget stop condition", () => {
  it("stops and escalates rather than burying the ledger", () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      obligation({ obligationId: `OBL-${i}`, reviewDate: days(1) }),
    );
    const result = sweepDeadlineHorizon({ ...empty, obligations: many });
    expect(result.findings).toHaveLength(200);
    expect(result.stoppedBy?.kind).toBe("budget");
  });
});
