import { describe, expect, it } from "vitest";
import {
  evaluateLeaveGuards,
  resolveLeaveDecision,
  type LeaveGuardInputs,
} from "./leave-decision-policy";

// D2 (BI-4D030159) safety core. The kernel may RECOMMEND, but these hard guards
// VETO to escalation — a leave-decisioning coworker must never auto-recommend
// approval into a coverage breach or a negative balance (BI acceptance #2/#3),
// regardless of what the kernel scores. Pure, kernel-independent.

const safe: LeaveGuardInputs = {
  requestedDays: 3,
  remainingBalance: 10,
  coverage: { requiredHeadcount: 2, coveredIfApproved: 3 },
  maxConsecutiveDays: 10,
  requestedConsecutiveDays: 3,
  inBlackoutWindow: false,
};

describe("evaluateLeaveGuards", () => {
  it("passes a fully safe request with no forced escalation", () => {
    const v = evaluateLeaveGuards(safe);
    expect(v.forceEscalate).toBe(false);
    expect(v.reasons).toEqual([]);
  });

  it("forces escalation when the request would overdraw the balance", () => {
    const v = evaluateLeaveGuards({ ...safe, requestedDays: 12, remainingBalance: 10 });
    expect(v.forceEscalate).toBe(true);
    expect(v.reasons.join(" ")).toMatch(/balance/i);
  });

  it("forces escalation when approving would breach required coverage", () => {
    const v = evaluateLeaveGuards({
      ...safe,
      coverage: { requiredHeadcount: 3, coveredIfApproved: 2 },
    });
    expect(v.forceEscalate).toBe(true);
    expect(v.reasons.join(" ")).toMatch(/coverage/i);
  });

  it("forces escalation when the run exceeds the consecutive-day limit", () => {
    const v = evaluateLeaveGuards({ ...safe, maxConsecutiveDays: 5, requestedConsecutiveDays: 9 });
    expect(v.forceEscalate).toBe(true);
    expect(v.reasons.join(" ")).toMatch(/consecutive/i);
  });

  it("forces escalation inside a blackout window", () => {
    const v = evaluateLeaveGuards({ ...safe, inBlackoutWindow: true });
    expect(v.forceEscalate).toBe(true);
    expect(v.reasons.join(" ")).toMatch(/blackout/i);
  });

  it("accumulates multiple reasons", () => {
    const v = evaluateLeaveGuards({
      ...safe,
      requestedDays: 99,
      inBlackoutWindow: true,
    });
    expect(v.forceEscalate).toBe(true);
    expect(v.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("with the default (no cushion) passes a request that sits exactly at the required minimum", () => {
    const v = evaluateLeaveGuards({ ...safe, coverage: { requiredHeadcount: 3, coveredIfApproved: 3 } });
    expect(v.forceEscalate).toBe(false);
  });

  it("with a coverage cushion, escalates a request that would sit exactly at the minimum (zero cushion)", () => {
    const v = evaluateLeaveGuards({
      ...safe,
      coverage: { requiredHeadcount: 3, coveredIfApproved: 3 },
      minCoverageCushion: 1,
    });
    expect(v.forceEscalate).toBe(true);
    expect(v.reasons.join(" ")).toMatch(/cushion/i);
  });

  it("with a coverage cushion, still passes when the cushion is satisfied", () => {
    const v = evaluateLeaveGuards({
      ...safe,
      coverage: { requiredHeadcount: 3, coveredIfApproved: 5 },
      minCoverageCushion: 1,
    });
    expect(v.forceEscalate).toBe(false);
  });
});

describe("resolveLeaveDecision", () => {
  it("escalates whenever a hard guard fired, even if the kernel recommends approval", () => {
    const action = resolveLeaveDecision({
      guards: { forceEscalate: true, reasons: ["would breach required coverage"] },
      decisionOutcome: "recommend-approve",
    });
    expect(action).toBe("escalate");
  });

  it("passes a clean kernel approval through when no guard fired", () => {
    const action = resolveLeaveDecision({
      guards: { forceEscalate: false, reasons: [] },
      decisionOutcome: "recommend-approve",
    });
    expect(action).toBe("approve");
  });

  it("passes a clean kernel denial through when no guard fired", () => {
    const action = resolveLeaveDecision({
      guards: { forceEscalate: false, reasons: [] },
      decisionOutcome: "recommend-deny",
    });
    expect(action).toBe("deny");
  });

  it("escalates an ambiguous kernel outcome (escalate/defer) with no guard", () => {
    expect(
      resolveLeaveDecision({ guards: { forceEscalate: false, reasons: [] }, decisionOutcome: "escalate" }),
    ).toBe("escalate");
    expect(
      resolveLeaveDecision({ guards: { forceEscalate: false, reasons: [] }, decisionOutcome: "defer" }),
    ).toBe("escalate");
  });
});
