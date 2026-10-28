import { describe, expect, it } from "vitest";

import { PAIRING_PROXY_LIMITATION, computeEfficacyMeasures, type EfficacyMeasureInputs } from "./efficacy-measures";

function inputs(overrides: Partial<EfficacyMeasureInputs> = {}): EfficacyMeasureInputs {
  return {
    period: { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-15T00:00:00Z") },
    permits: { total: 40, enforcedValid: 0, perAgent: [{ agent: "AGT-A", total: 30, enforcedValid: 0 }, { agent: "direct", total: 10, enforcedValid: 0 }] },
    consequentialEffects: 20,
    decisions: { total: 50, humanResolved: 5, agentResolved: 9, escalated: 10, held: 5, admitted: 30, admittedHumanChoice: 4, admittedAgentChoice: 8 },
    envelopes: { proposed: 3, approved: 1, executed: 12, declined: 2, failed: 1, expired: 4, cancelled: 0 },
    authorization: { total: 200, denied: 8, deniedByAction: { create_backlog_item: 2, start_build: 6 }, enforcedPermitRefusals: 0 },
    shadow: { withExecution: 25, divergentSucceeded: 5 },
    guards: [
      {
        guardId: "loop:check-no-x",
        runs: 40,
        refusals: 6,
        caught: 3,
        falseRefusals: 1,
        overridden: 1,
        unresolved: 1,
        unresolvedByReason: { "base-moved": 1 },
        totalDurationMs: 80_000,
        medianDurationMs: 2_000,
      },
    ],
    ...overrides,
  };
}

function byId(report: ReturnType<typeof computeEfficacyMeasures>, id: string) {
  const found = [...report.gpp, ...report.proxies].find((m) => m.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe("computeEfficacyMeasures — GPP §11 with denominators", () => {
  it("publishes M-1 to M-7, each with numerator, denominator, unit and stated omissions", () => {
    const report = computeEfficacyMeasures(inputs());
    expect(report.gpp.map((m) => m.id)).toEqual(["M-1", "M-2", "M-3", "M-4", "M-5", "M-6", "M-7"]);
    for (const m of report.gpp) expect(m.omits.length).toBeGreaterThan(10);
    expect(byId(report, "M-1")).toMatchObject({ numerator: 0, denominator: 40, value: 0, unit: "share" });
    expect(byId(report, "M-4")).toMatchObject({ numerator: 8, denominator: 200, value: 0.04 });
    expect(byId(report, "M-6")).toMatchObject({ numerator: 5, denominator: 25, value: 0.2 });
  });

  it("M-2 overall is unknown; the kernel-only ratio is a named subset proxy in decisions per effect", () => {
    const report = computeEfficacyMeasures(inputs());
    expect(byId(report, "M-2")).toMatchObject({ value: null, numerator: null, denominator: null });
    expect(byId(report, "M-2a")).toMatchObject({ numerator: 5, denominator: 20, value: 0.25, unit: "decisions/effect" });
  });

  it("zero kernel human choices never reads as zero approvals: the envelope load is published beside it", () => {
    const report = computeEfficacyMeasures(inputs({ decisions: { ...inputs().decisions, humanResolved: 0 } }));
    expect(byId(report, "M-2a").numerator).toBe(0);
    expect(report.approvalLoad.map((m) => [m.id, m.numerator])).toEqual([
      ["envelopes:total", 23],
      ["envelopes:waiting", 3],
      ["envelopes:approved", 1],
      ["envelopes:executed", 12],
      ["envelopes:declined", 2],
      ["envelopes:failed", 1],
      ["envelopes:expired", 4],
      ["envelopes:cancelled", 0],
    ]);
    for (const m of report.approvalLoad) expect(m.unit).toBe("count");
  });

  it("M-7 observed-outcome coverage is unknown; choice linkage is split into human and agent-reported", () => {
    const report = computeEfficacyMeasures(inputs());
    expect(byId(report, "M-7")).toMatchObject({ value: null });
    expect(byId(report, "M-7a")).toMatchObject({ numerator: 4, denominator: 30 });
    expect(byId(report, "M-7b")).toMatchObject({ numerator: 8, denominator: 30 });
  });

  it("M-5 is null with its reason, never zero", () => {
    expect(byId(computeEfficacyMeasures(inputs()), "M-5")).toMatchObject({ numerator: null, denominator: null, value: null });
  });

  it("a zero denominator is a null value, not zero", () => {
    const report = computeEfficacyMeasures(inputs({ shadow: { withExecution: 0, divergentSucceeded: 0 } }));
    expect(byId(report, "M-6")).toMatchObject({ numerator: 0, denominator: 0, value: null });
  });

  it("breaks M-1 out per agent, M-3 into its mix and M-4 by action", () => {
    const report = computeEfficacyMeasures(inputs());
    expect(report.m1PerAgent.map((m) => [m.label, m.denominator])).toEqual([["AGT-A", 30], ["direct", 10]]);
    expect(report.m3Mix.map((m) => [m.id, m.numerator])).toEqual([
      ["M-3:human", 5], ["M-3:escalated", 10], ["M-3:held", 5], ["M-3:doctrine-only", 30],
    ]);
    expect(report.m4ByAction.map((m) => [m.label, m.numerator])).toEqual([["start_build", 6], ["create_backlog_item", 2]]);
  });
});

describe("computeEfficacyMeasures — guard measures", () => {
  it("computes G-1, G-2, G-3, G-5 with denominators and keeps G-4 cost", () => {
    const [guard] = computeEfficacyMeasures(inputs()).guards;
    expect(guard.catchRate).toMatchObject({ numerator: 3, denominator: 6, value: 0.5 });
    expect(guard.falseRefusalRate).toMatchObject({ numerator: 1, denominator: 4, value: 0.25 });
    expect(guard.overrideRate).toMatchObject({ numerator: 1, denominator: 6 });
    expect(guard.undecidedShare).toMatchObject({ numerator: 1, denominator: 6 });
    expect(guard).toMatchObject({ runs: 40, totalDurationMs: 80_000, medianDurationMs: 2_000 });
  });

  it("publishes the pairing-proxy limitation beside the catch and false-refusal rates", () => {
    const [guard] = computeEfficacyMeasures(inputs()).guards;
    expect(guard.catchRate.omits).toContain(PAIRING_PROXY_LIMITATION);
    expect(guard.falseRefusalRate.omits).toContain(PAIRING_PROXY_LIMITATION);
  });

  it("orders guards by total cost, most expensive first", () => {
    const report = computeEfficacyMeasures(
      inputs({
        guards: [
          { ...inputs().guards[0], guardId: "loop:cheap", totalDurationMs: 10 },
          { ...inputs().guards[0], guardId: "loop:dear", totalDurationMs: 10_000 },
        ],
      }),
    );
    expect(report.guards.map((g) => g.guardId)).toEqual(["loop:dear", "loop:cheap"]);
  });
});
