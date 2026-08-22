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
  appliesToInstall: true,
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

// ── the live-install regression: 88 of 141 findings were false ──────────────

describe("frequency classes that are CORRECTLY dateless", () => {
  it("says nothing about a continuous obligation with no review date", () => {
    const result = sweepDeadlineHorizon({
      ...empty,
      obligations: [obligation({ frequency: "continuous" })],
    });
    // A standing control is in force every day. It is not overdue.
    expect(result.findings).toEqual([]);
  });

  it("says nothing about an event-driven obligation with no review date", () => {
    const result = sweepDeadlineHorizon({
      ...empty,
      obligations: [obligation({ frequency: "event-driven" })],
    });
    expect(result.findings).toEqual([]);
  });

  it("says nothing about a continuous CONTROL with no review dates", () => {
    const result = sweepDeadlineHorizon({
      ...empty,
      controls: [control({ reviewFrequency: "continuous" })],
      obligations: [obligation({ frequency: "continuous" })],
    });
    expect(result.findings).toEqual([]);
  });

  it("reproduces the live mix and reports ONLY the genuine recurrences", () => {
    // The exact shape of the live install: 46 continuous, 42 event-driven,
    // 27 annual, 7 monthly — all dateless. Only the 34 real recurrences are
    // defects; the first sweep reported all 122.
    const mix = [
      ...Array.from({ length: 46 }, (_, i) => obligation({ obligationId: `C-${i}`, frequency: "continuous" })),
      ...Array.from({ length: 42 }, (_, i) => obligation({ obligationId: `E-${i}`, frequency: "event-driven" })),
      ...Array.from({ length: 27 }, (_, i) => obligation({ obligationId: `A-${i}`, frequency: "annual" })),
      ...Array.from({ length: 7 }, (_, i) => obligation({ obligationId: `M-${i}`, frequency: "monthly" })),
    ];
    const result = sweepDeadlineHorizon({ ...empty, obligations: mix });
    expect(result.findings).toHaveLength(34);
    for (const f of result.findings) {
      expect(f.evidence.triggerClass).toBe("cadence");
    }
  });
});

describe("a frequency nothing can compute", () => {
  it("is its own low finding, not a guessed date", () => {
    const result = sweepDeadlineHorizon({
      ...empty,
      obligations: [obligation({ frequency: "whenever the board meets" })],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence.reason).toBe("uncomputable-frequency");
    expect(result.findings[0].policySeverity).toBe("low");
    expect(result.findings[0].remediationHint.suggestedReviewDate).toBeNull();
  });

  it("says nothing when no frequency is recorded at all", () => {
    const result = sweepDeadlineHorizon({
      ...empty,
      obligations: [obligation({ frequency: null })],
      controls: [control({ reviewFrequency: null })],
    });
    expect(result.findings).toEqual([]);
  });
});

// ── the live-install defect: obligations that do not bind on this business ───

describe("obligations whose regulation does not apply to this install", () => {
  it("are never findings, however overdue they look", () => {
    // What this prevents, observed live: a software-platform install was told
    // its bank supervision filings, its municipal water testing, and its UK
    // premium-listing declaration were overdue. Compliance packs seed
    // unconditionally and are filtered at READ time; the sweep is a reader and
    // must filter too.
    const result = sweepDeadlineHorizon({
      ...empty,
      obligations: [
        obligation({ obligationId: "IN", reviewDate: days(-5) }),
        obligation({ obligationId: "OUT", reviewDate: days(-5), appliesToInstall: false }),
      ],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence.obligationId).toBe("IN");
  });

  it("counts what it skipped, so the number is visible rather than assumed", () => {
    const result = sweepDeadlineHorizon({
      ...empty,
      obligations: [
        obligation({ obligationId: "IN", reviewDate: days(1) }),
        obligation({ obligationId: "OUT-1", frequency: "annual", appliesToInstall: false }),
        obligation({ obligationId: "OUT-2", frequency: "annual", appliesToInstall: false }),
      ],
    });
    expect(result.scanned.obligations).toBe(1);
    expect(result.scanned.obligationsOutOfScope).toBe(2);
  });

  it("treats 'read fine, nothing in scope' as a clean sweep, not a failure", () => {
    // The distinction matters: reporting this as a failure would train the
    // operator to ignore the one signal that means the sweep is really broken.
    const result = sweepDeadlineHorizon({
      ...empty,
      obligations: [obligation({ frequency: "annual", appliesToInstall: false })],
    });
    expect(result.findings).toEqual([]);
    expect(result.stoppedBy).toBeNull();
  });

  it("still fails closed when it read nothing at all", () => {
    expect(sweepDeadlineHorizon(empty).stoppedBy?.kind).toBe("failure");
  });
});
