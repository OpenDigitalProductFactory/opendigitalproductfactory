import { describe, expect, it } from "vitest";

import {
  canTransition,
  endOfLocalDay,
  evaluateDiscrepancyTransition,
  lossReportingDeadlines,
  requiresLossReporting,
  type DiscrepancyState,
} from "./discrepancy-policy";

function state(overrides: Partial<DiscrepancyState> = {}): DiscrepancyState {
  return {
    status: "investigating",
    classification: "unclassified",
    classificationRationale: null,
    regulatorNoticeGivenAt: null,
    regulatorNoticeRef: null,
    lossReportFiledAt: null,
    lossReportRef: null,
    resolution: null,
    ...overrides,
  };
}

describe("discrepancy lifecycle", () => {
  it("follows the veterinary design's transitions and never reopens a closed case", () => {
    expect(canTransition("detected", "investigating")).toBe(true);
    expect(canTransition("detected", "closed")).toBe(false);
    expect(canTransition("adjustment_approved", "reconciled")).toBe(true);
    expect(canTransition("closed", "investigating")).toBe(false);
  });

  it("reports only suspected theft and significant loss", () => {
    expect(requiresLossReporting("suspected_theft")).toBe(true);
    expect(requiresLossReporting("significant_loss")).toBe(true);
    expect(requiresLossReporting("recording_error")).toBe(false);
  });
});

describe("lossReportingDeadlines (21 CFR 1301.76(b))", () => {
  it("gives notice by the end of the next business day and Form 106 at 45 days, in local time", () => {
    // Friday 2026-10-02 at 18:00 Chicago (23:00Z).
    const deadlines = lossReportingDeadlines({
      discoveredAt: new Date("2026-10-02T23:00:00Z"),
      timeZone: "America/Chicago",
    });
    expect(deadlines.discoveredOn).toBe("2026-10-02");
    expect(deadlines.regulatorNoticeDueOn).toBe("2026-10-05");
    expect(deadlines.regulatorNoticeDueAt.toISOString()).toBe("2026-10-06T04:59:59.999Z");
    expect(deadlines.lossReportDueOn).toBe("2026-11-16");
    // CST after the DST change: UTC-6.
    expect(deadlines.lossReportDueAt.toISOString()).toBe("2026-11-17T05:59:59.999Z");
  });

  it("uses the register's local date, not the UTC date", () => {
    // 2026-10-03 01:30Z is still Friday evening in Chicago.
    expect(
      lossReportingDeadlines({ discoveredAt: new Date("2026-10-03T01:30:00Z"), timeZone: "America/Chicago" }).discoveredOn,
    ).toBe("2026-10-02");
  });

  it("skips configured holidays", () => {
    const deadlines = lossReportingDeadlines({
      discoveredAt: new Date("2026-12-24T15:00:00Z"),
      timeZone: "America/New_York",
      holidays: ["2026-12-25"],
    });
    expect(deadlines.regulatorNoticeDueOn).toBe("2026-12-28");
  });

  it("computes end of local day across offsets", () => {
    expect(endOfLocalDay("2026-07-01", "UTC").toISOString()).toBe("2026-07-01T23:59:59.999Z");
    expect(endOfLocalDay("2026-07-01", "Europe/London").toISOString()).toBe("2026-07-01T22:59:59.999Z");
  });
});

describe("evaluateDiscrepancyTransition", () => {
  it("refuses an illegal transition", () => {
    expect(evaluateDiscrepancyTransition("detected", "closed", state({ resolution: "x" }))).toMatchObject({
      allowed: false,
      refusals: [{ code: "illegal_transition" }],
    });
  });

  it("requires a rationale for any classification", () => {
    const result = evaluateDiscrepancyTransition("investigating", "escalated", state({ classification: "suspected_theft" }));
    expect(result).toMatchObject({ allowed: false, refusals: [{ code: "rationale_required" }] });
  });

  it("refuses escalation of a case that is not theft or significant loss", () => {
    const result = evaluateDiscrepancyTransition(
      "investigating",
      "escalated",
      state({ classification: "recording_error", classificationRationale: "Transcription" }),
    );
    expect(result).toMatchObject({ allowed: false, refusals: [{ code: "rationale_required" }] });
  });

  it("refuses to reconcile a theft case without notice and Form 106 evidence", () => {
    const theft = state({
      status: "escalated",
      classification: "suspected_theft",
      classificationRationale: "Vial missing from locked safe",
      resolution: "Reported; staff re-trained",
    });
    const refused = evaluateDiscrepancyTransition("escalated", "reconciled", theft);
    expect(refused.allowed).toBe(false);
    if (refused.allowed) return;
    expect(refused.refusals.map((refusal) => refusal.code)).toEqual(["regulator_notice_missing", "loss_report_missing"]);

    const evidenced = {
      ...theft,
      regulatorNoticeGivenAt: new Date("2026-10-05T14:00:00Z"),
      regulatorNoticeRef: "Letter to Chicago Field Division",
      lossReportFiledAt: new Date("2026-10-20T14:00:00Z"),
      lossReportRef: "DEA-106 TL-123456",
    };
    expect(evaluateDiscrepancyTransition("escalated", "reconciled", evidenced)).toEqual({ allowed: true });
  });

  it("lets an explained recording error reconcile with a resolution only", () => {
    expect(
      evaluateDiscrepancyTransition(
        "investigating",
        "reconciled",
        state({ classification: "recording_error", classificationRationale: "Dose entered twice", resolution: "Reversed CSM-9" }),
      ),
    ).toEqual({ allowed: true });
  });
});
