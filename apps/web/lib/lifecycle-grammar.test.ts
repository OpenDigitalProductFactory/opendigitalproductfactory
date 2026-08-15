import { describe, expect, it } from "vitest";
import {
  canAdvance,
  getState,
  summarizeLifecycle,
  validateGrammar,
  type LifecycleGrammar,
} from "./lifecycle-grammar";
import {
  CUSTOMER_ACCOUNT_GRAMMAR,
  LIFECYCLE_GRAMMARS,
  OPPORTUNITY_GRAMMAR,
  grammarKeyForKind,
  resolveCustomerAccountPoint,
  resolveOpportunityPoint,
} from "./lifecycle-grammars";

describe("validateGrammar", () => {
  it("accepts every declared grammar", () => {
    for (const grammar of Object.values(LIFECYCLE_GRAMMARS)) {
      expect(() => validateGrammar(grammar)).not.toThrow();
    }
  });

  it("rejects a stage with no entry state", () => {
    const bad: LifecycleGrammar = {
      key: "bad",
      label: "Bad",
      stages: [{ key: "s1", label: "S1", advancesTo: [], isTerminal: true, states: [{ key: "x", label: "X", band: "on-track" }] }],
    };
    expect(() => validateGrammar(bad)).toThrow(/exactly one entry state/);
  });

  it("rejects a non-terminal stage with no exit-ready state", () => {
    const bad: LifecycleGrammar = {
      key: "bad",
      label: "Bad",
      stages: [
        { key: "s1", label: "S1", advancesTo: ["s2"], states: [{ key: "x", label: "X", band: "on-track", isEntry: true }] },
        { key: "s2", label: "S2", advancesTo: [], isTerminal: true, states: [{ key: "y", label: "Y", band: "on-track", isEntry: true }] },
      ],
    };
    expect(() => validateGrammar(bad)).toThrow(/exit-ready/);
  });

  it("rejects an advancesTo pointing at an unknown stage", () => {
    const bad: LifecycleGrammar = {
      key: "bad",
      label: "Bad",
      stages: [{ key: "s1", label: "S1", advancesTo: ["nope"], states: [{ key: "x", label: "X", band: "ready", isEntry: true, isExitReady: true }] }],
    };
    expect(() => validateGrammar(bad)).toThrow(/unknown stage "nope"/);
  });

  it("rejects isTerminal with a non-empty advancesTo", () => {
    const bad: LifecycleGrammar = {
      key: "bad",
      label: "Bad",
      stages: [
        { key: "s1", label: "S1", advancesTo: ["s2"], isTerminal: true, states: [{ key: "x", label: "X", band: "ready", isEntry: true, isExitReady: true }] },
        { key: "s2", label: "S2", advancesTo: [], isTerminal: true, states: [{ key: "y", label: "Y", band: "on-track", isEntry: true }] },
      ],
    };
    expect(() => validateGrammar(bad)).toThrow(/isTerminal is true but advancesTo is non-empty/);
  });

  it("rejects a self-referential advancesTo", () => {
    const bad: LifecycleGrammar = {
      key: "bad",
      label: "Bad",
      stages: [{ key: "s1", label: "S1", advancesTo: ["s1"], states: [{ key: "x", label: "X", band: "ready", isEntry: true, isExitReady: true }] }],
    };
    expect(() => validateGrammar(bad)).toThrow(/may not reference itself/);
  });
});

describe("canAdvance gate", () => {
  it("allows advance only from an exit-ready state to a legal target", () => {
    expect(canAdvance(CUSTOMER_ACCOUNT_GRAMMAR, { stage: "prospect", state: "prospect" }, "qualified")).toEqual({ allowed: true });
  });

  it("allows exit to a terminal stage from a blocked (non-exit-ready) in-stage state", () => {
    // Involuntary churn / termination: an at_risk or suspended account may close from that state.
    expect(canAdvance(CUSTOMER_ACCOUNT_GRAMMAR, { stage: "active", state: "at_risk" }, "closed")).toEqual({ allowed: true });
    expect(canAdvance(CUSTOMER_ACCOUNT_GRAMMAR, { stage: "active", state: "suspended" }, "closed")).toEqual({ allowed: true });
  });

  it("refuses forward advance to a NON-terminal stage from a non-exit-ready state", () => {
    const g: LifecycleGrammar = {
      key: "t",
      label: "T",
      stages: [
        {
          key: "s1",
          label: "S1",
          advancesTo: ["s2", "done"],
          states: [
            { key: "ready", label: "Ready", band: "ready", isEntry: true, isExitReady: true },
            { key: "stuck", label: "Stuck", band: "blocked" },
          ],
        },
        { key: "s2", label: "S2", advancesTo: ["done"], states: [{ key: "e", label: "E", band: "ready", isEntry: true, isExitReady: true }] },
        { key: "done", label: "Done", advancesTo: [], isTerminal: true, states: [{ key: "x", label: "X", band: "on-track", isEntry: true }] },
      ],
    };
    // stuck → s2 (non-terminal) is refused; stuck → done (terminal exit) is allowed.
    expect(canAdvance(g, { stage: "s1", state: "stuck" }, "s2").allowed).toBe(false);
    expect(canAdvance(g, { stage: "s1", state: "stuck" }, "done")).toEqual({ allowed: true });
  });

  it("refuses advance to a stage not in advancesTo", () => {
    const check = canAdvance(CUSTOMER_ACCOUNT_GRAMMAR, { stage: "prospect", state: "prospect" }, "active");
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/does not advance to/);
  });

  it("refuses unknown stage/state", () => {
    expect(canAdvance(CUSTOMER_ACCOUNT_GRAMMAR, { stage: "nope", state: "x" }, "qualified").allowed).toBe(false);
    expect(canAdvance(CUSTOMER_ACCOUNT_GRAMMAR, { stage: "active", state: "nope" }, "closed").allowed).toBe(false);
  });
});

describe("summarizeLifecycle two-axis rollup", () => {
  it("counts by stage and by band, with per-stage bands", () => {
    const points = [
      { stage: "active", state: "active" },
      { stage: "active", state: "at_risk" },
      { stage: "prospect", state: "prospect" },
    ];
    const summary = summarizeLifecycle(CUSTOMER_ACCOUNT_GRAMMAR, points);
    expect(summary.byStage.active).toBe(2);
    expect(summary.byStage.prospect).toBe(1);
    expect(summary.byBand.blocked).toBe(1); // at_risk
    expect(summary.byBand["on-track"]).toBe(2); // active + prospect
    expect(summary.byStageBand.active).toEqual({ "on-track": 1, blocked: 1, ready: 0 });
    expect(summary.unresolved).toBe(0);
  });

  it("counts unresolved points that do not map into the grammar", () => {
    const summary = summarizeLifecycle(CUSTOMER_ACCOUNT_GRAMMAR, [{ stage: "ghost", state: "x" }]);
    expect(summary.unresolved).toBe(1);
  });
});

describe("customer-account native decomposition (all 9 statuses)", () => {
  const cases: Array<[string, string, string]> = [
    ["prospect", "prospect", "prospect"],
    ["qualified", "qualified", "qualified"],
    ["onboarding", "onboarding", "onboarding"],
    ["active", "active", "active"],
    ["at_risk", "active", "at_risk"],
    ["suspended", "active", "suspended"],
    ["closed", "closed", "closed"],
    ["superseded", "closed", "superseded"],
    ["archived", "closed", "archived"],
  ];
  it.each(cases)("maps status %s → stage %s / state %s that resolves in the grammar", (status, stage, state) => {
    const point = resolveCustomerAccountPoint(status);
    expect(point).toEqual({ stage, state });
    expect(getState(CUSTOMER_ACCOUNT_GRAMMAR, point.stage, point.state)).not.toBeNull();
  });
});

describe("opportunity grammar mirrors the pre-existing pipeline-inspector data", () => {
  it("carries the same per-stage exit criteria and stale thresholds", () => {
    const qualification = OPPORTUNITY_GRAMMAR.stages.find((s) => s.key === "qualification")!;
    expect(qualification.staleAfterDays).toBe(7);
    expect(qualification.exitCriteria).toEqual([
      "Buyer problem is clear",
      "Account and primary contact are known",
      "Value hypothesis is recorded",
    ]);
    expect(OPPORTUNITY_GRAMMAR.stages.find((s) => s.key === "proposal")!.staleAfterDays).toBe(14);
  });

  it("resolves every open + closed opportunity stage to a valid point", () => {
    for (const stage of ["qualification", "discovery", "proposal", "negotiation", "closed_won", "closed_lost"]) {
      const point = resolveOpportunityPoint(stage);
      expect(getState(OPPORTUNITY_GRAMMAR, point.stage, point.state)).not.toBeNull();
    }
  });
});

describe("grammar kind registry", () => {
  it("maps grammar-driven entity kinds to their grammar key", () => {
    expect(grammarKeyForKind("CustomerAccount")).toBe("customer-account");
    expect(grammarKeyForKind("Opportunity")).toBe("opportunity");
    expect(grammarKeyForKind("EaElement")).toBeNull(); // EA governed things are not grammar-driven
  });
});
