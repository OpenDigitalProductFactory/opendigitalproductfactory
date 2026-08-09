import { describe, expect, it } from "vitest";

import { buildAwaitingDigest, buildDecisionHelp, type DecisionHelpInput } from "./decision-help";
import { buildTierStats } from "./decision-audit";

function input(overrides: Partial<DecisionHelpInput> = {}): DecisionHelpInput {
  return {
    outcomeType: "escalate",
    tier: "wwmd",
    riskTier: "medium",
    principleConflict: false,
    insufficientSignal: false,
    hasBuild: false,
    resolved: false,
    contextMissing: false,
    ...overrides,
  };
}

describe("buildDecisionHelp", () => {
  it("explains an insufficient-signal escalation without decision-engine jargon", () => {
    const help = buildDecisionHelp(input({ insufficientSignal: true }));
    expect(help.meaning).toContain("without scoreable options");
    expect(help.meaning).not.toMatch(/composite|feature vector|contribution/i);
    expect(help.steps.length).toBeGreaterThan(0);
  });

  it("names the principle conflict when the gate flagged one", () => {
    const help = buildDecisionHelp(input({ principleConflict: true }));
    expect(help.meaning).toContain("opposite directions");
  });

  it("explains high-risk escalations as policy, not as a failure", () => {
    const help = buildDecisionHelp(input({ riskTier: "high" }));
    expect(help.meaning).toContain("high-risk");
    expect(help.meaning).toContain("always routes");
  });

  it("tells the reader nothing is stuck for a fire-and-forget consult", () => {
    const help = buildDecisionHelp(input());
    expect(help.urgency).toContain("Nothing is stuck");
  });

  it("identifies an incomplete historical record without pretending it can be resolved", () => {
    const help = buildDecisionHelp(input({ contextMissing: true }));
    expect(help.meaning).toContain("does not contain enough context");
    expect(help.urgency).toContain("excluded from action queues");
    expect(help.steps).toHaveLength(0);
  });

  it("says a build is paused — and leads with the Build Studio step — when the consult came from a build gate", () => {
    const help = buildDecisionHelp(input({ hasBuild: true }));
    expect(help.urgency).toContain("paused");
    expect(help.steps[0]?.href).toBe("/build");
  });

  it("routes each tier's follow-up to its own authoring surface", () => {
    const wwmd = buildDecisionHelp(input({ tier: "wwmd" }));
    const wsid = buildDecisionHelp(input({ tier: "wsid", outcomeType: "defer" }));
    const wwwd = buildDecisionHelp(input({ tier: "wwwd", outcomeType: "defer" }));
    expect(wwmd.steps.map((s) => s.href)).toContain("/coworker-decisions/stance");
    expect(wsid.steps.map((s) => s.href)).toContain("/coworker-decisions/craft");
    // WWWD is answerable inline on the review surface — one step, no stance editor detour.
    expect(wwwd.steps).toHaveLength(1);
    expect(wwwd.steps[0]?.href).toBe("/coworker-decisions/review");
  });

  it("describes a defer as a coverage gap, not a refusal", () => {
    const help = buildDecisionHelp(input({ outcomeType: "defer", tier: "wsid" }));
    expect(help.meaning).toContain("declined to guess");
    expect(help.meaning).toContain("craft playbook");
  });

  it("collapses to a no-action read once a human resolved it", () => {
    const help = buildDecisionHelp(input({ resolved: true }));
    expect(help.urgency).toContain("Resolved");
    expect(help.steps).toHaveLength(0);
  });

  it("gives recommend and arbitrate rows a nothing-needed read", () => {
    for (const outcomeType of ["recommend", "arbitrate"]) {
      const help = buildDecisionHelp(input({ outcomeType }));
      expect(help.urgency).toContain("Nothing is needed from you");
      expect(help.steps).toHaveLength(0);
    }
  });
});

describe("buildAwaitingDigest", () => {
  const stats = (unresolved: [number, number, number]) =>
    (["wwmd", "wwwd", "wsid"] as const).map((tier, i) =>
      buildTierStats({
        tier,
        total: 100,
        last7d: 5,
        last30d: 20,
        unresolved: unresolved[i]!,
        lastDecisionAt: null,
      }));

  it("returns null when nothing is waiting so the panel disappears", () => {
    expect(buildAwaitingDigest(stats([0, 0, 0]))).toBeNull();
  });

  it("totals across tiers and only names the tiers that have load", () => {
    const digest = buildAwaitingDigest(stats([29, 0, 45]));
    expect(digest?.headline).toBe("74 decisions are waiting on a human");
    expect(digest?.fragments).toEqual([
      "29 platform doctrine (WWMD)",
      "45 role craft (WSID)",
    ]);
  });

  it("uses the singular headline for a single waiting decision", () => {
    expect(buildAwaitingDigest(stats([1, 0, 0]))?.headline).toBe(
      "1 decision is waiting on a human",
    );
  });
});
