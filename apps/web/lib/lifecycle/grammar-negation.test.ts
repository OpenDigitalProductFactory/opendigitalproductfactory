import { describe, expect, it } from "vitest";

import type { LifecycleHealthBand } from "@/lib/lifecycle-grammar";
import {
  analyzeGrammarNegation,
  buildGrammarSnapshot,
  parseLifecycleDependencies,
  resolveDependency,
  serializeSnapshot,
  type GrammarSnapshot,
} from "./grammar-negation";

// Deep-MUTABLE mirror of the grammar shape so the fixture can be edited freely in
// tests (the real LifecycleGrammar arrays are readonly). A mutable structure is
// still assignable to buildGrammarSnapshot's readonly-typed parameter.
type MutState = { key: string; label: string; band: LifecycleHealthBand; isEntry?: boolean; isExitReady?: boolean };
type MutStage = {
  key: string;
  label: string;
  advancesTo: string[];
  isTerminal?: boolean;
  exitCriteria?: string[];
  staleAfterDays?: number;
  states: MutState[];
};
type MutGrammar = { key: string; label: string; stages: MutStage[] };

// A tiny two-grammar fixture registry, including a `retain` stage so the BI's
// named regression (gutting OVSM retain while a stance depends on it) is exercised
// without coupling the test to the live grammar corpus.
function fixtureRegistry(): Record<string, MutGrammar> {
  return {
    ovsm: {
      key: "ovsm",
      label: "Operational value stream",
      stages: [
        {
          key: "acquire",
          label: "Acquire",
          advancesTo: ["retain"],
          exitCriteria: ["first value delivered"],
          states: [{ key: "open", label: "Open", band: "on-track", isEntry: true, isExitReady: true }],
        },
        {
          key: "retain",
          label: "Retain",
          advancesTo: [],
          isTerminal: true,
          exitCriteria: ["renewal secured"],
          states: [
            { key: "active", label: "Active", band: "on-track", isEntry: true },
            { key: "at_risk", label: "At risk", band: "blocked" },
          ],
        },
      ],
    },
    account: {
      key: "account",
      label: "Account",
      stages: [
        {
          key: "closed",
          label: "Closed",
          advancesTo: [],
          isTerminal: true,
          states: [{ key: "closed", label: "Closed", band: "on-track", isEntry: true }],
        },
      ],
    },
  };
}

describe("parseLifecycleDependencies", () => {
  it("reads valid dependencies, carrying state only when present", () => {
    const deps = parseLifecycleDependencies({
      lifecycleDependencies: [
        { grammar: "ovsm", stage: "retain" },
        { grammar: "ovsm", stage: "retain", state: "active" },
      ],
    });
    expect(deps).toEqual([
      { grammar: "ovsm", stage: "retain" },
      { grammar: "ovsm", stage: "retain", state: "active" },
    ]);
  });

  it("returns [] for absent / non-array / malformed metadata without throwing", () => {
    expect(parseLifecycleDependencies(null)).toEqual([]);
    expect(parseLifecycleDependencies("nope")).toEqual([]);
    expect(parseLifecycleDependencies({})).toEqual([]);
    expect(parseLifecycleDependencies({ lifecycleDependencies: "x" })).toEqual([]);
    // entries missing grammar or stage, or of wrong type, are dropped individually
    expect(
      parseLifecycleDependencies({
        lifecycleDependencies: [
          { stage: "retain" },
          { grammar: "ovsm" },
          { grammar: 3, stage: "retain" },
          "junk",
          { grammar: "ovsm", stage: "retain", state: 9 },
        ],
      }),
    ).toEqual([{ grammar: "ovsm", stage: "retain" }]); // last entry keeps stage, drops bad state
  });
});

describe("buildGrammarSnapshot + resolveDependency", () => {
  it("captures every stage and state with its semantic descriptor", () => {
    const snap = buildGrammarSnapshot(fixtureRegistry());
    expect(snap.stages["ovsm::retain"]).toEqual({
      label: "Retain",
      exitCriteria: ["renewal secured"],
    });
    expect(snap.states["ovsm::retain::at_risk"]).toEqual({ label: "At risk", band: "blocked" });
  });

  it("serializes deterministically (sorted keys, stable bytes)", () => {
    const a = serializeSnapshot(buildGrammarSnapshot(fixtureRegistry()));
    const b = serializeSnapshot(buildGrammarSnapshot(fixtureRegistry()));
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
  });

  it("resolves stage-level and state-level deps; rejects unknowns", () => {
    const reg = fixtureRegistry();
    expect(resolveDependency({ grammar: "ovsm", stage: "retain" }, reg)).toBe(true);
    expect(resolveDependency({ grammar: "ovsm", stage: "retain", state: "at_risk" }, reg)).toBe(true);
    expect(resolveDependency({ grammar: "ovsm", stage: "gone" }, reg)).toBe(false);
    expect(resolveDependency({ grammar: "ovsm", stage: "retain", state: "gone" }, reg)).toBe(false);
    expect(resolveDependency({ grammar: "nope", stage: "retain" }, reg)).toBe(false);
  });
});

describe("analyzeGrammarNegation", () => {
  const previous = buildGrammarSnapshot(fixtureRegistry());

  function withMutation(mut: (reg: Record<string, MutGrammar>) => void): GrammarSnapshot {
    const reg = fixtureRegistry();
    mut(reg);
    return buildGrammarSnapshot(reg);
  }

  it("REGRESSION: gutting the retain stage while a stance depends on it is caught as negating", () => {
    const current = withMutation((reg) => {
      reg.ovsm.stages = reg.ovsm.stages.filter((s) => s.key !== "retain");
    });
    const findings = analyzeGrammarNegation(previous, current, [
      { slug: "stances/recurring-use-is-the-goal", dependencies: [{ grammar: "ovsm", stage: "retain" }] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      slug: "stances/recurring-use-is-the-goal",
      delta: "removed",
      severity: "negating",
    });
  });

  it("catches a removed in-stage STATE a stance depends on", () => {
    const current = withMutation((reg) => {
      reg.ovsm.stages[1].states = reg.ovsm.stages[1].states.filter((s) => s.key !== "at_risk");
    });
    const findings = analyzeGrammarNegation(previous, current, [
      { slug: "stances/watch-at-risk", dependencies: [{ grammar: "ovsm", stage: "retain", state: "at_risk" }] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ delta: "removed", severity: "negating" });
  });

  it("treats a rename as a removal of the old key (negating)", () => {
    const current = withMutation((reg) => {
      reg.ovsm.stages[1] = { ...reg.ovsm.stages[1], key: "renew" };
    });
    const findings = analyzeGrammarNegation(previous, current, [
      { slug: "stances/x", dependencies: [{ grammar: "ovsm", stage: "retain" }] },
    ]);
    expect(findings[0]).toMatchObject({ delta: "removed", severity: "negating" });
  });

  it("flags a re-semanticized (label/band/exit-criteria changed) element as weakening", () => {
    const current = withMutation((reg) => {
      reg.ovsm.stages[1] = { ...reg.ovsm.stages[1], exitCriteria: ["something entirely different"] };
    });
    const findings = analyzeGrammarNegation(previous, current, [
      { slug: "stances/x", dependencies: [{ grammar: "ovsm", stage: "retain" }] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ delta: "resemanticized", severity: "weakening" });
  });

  it("flags a state band change as weakening", () => {
    const current = withMutation((reg) => {
      reg.ovsm.stages[1].states = reg.ovsm.stages[1].states.map((s) =>
        s.key === "at_risk" ? { ...s, band: "ready" } : s,
      );
    });
    const findings = analyzeGrammarNegation(previous, current, [
      { slug: "stances/x", dependencies: [{ grammar: "ovsm", stage: "retain", state: "at_risk" }] },
    ]);
    expect(findings[0]).toMatchObject({ delta: "resemanticized", severity: "weakening" });
  });

  it("reports NOTHING when an unrelated element changes or an element is added", () => {
    const current = withMutation((reg) => {
      // change a stage nobody depends on + add a brand-new stage
      reg.account.stages[0] = { ...reg.account.stages[0], label: "Closed/Lost" };
      reg.ovsm.stages.push({ key: "expand", label: "Expand", advancesTo: [], states: [] });
    });
    const findings = analyzeGrammarNegation(previous, current, [
      { slug: "stances/x", dependencies: [{ grammar: "ovsm", stage: "retain" }] },
    ]);
    expect(findings).toEqual([]);
  });

  it("skips a dependency that was never valid in the previous snapshot (not this change's doing)", () => {
    const current = buildGrammarSnapshot(fixtureRegistry());
    const findings = analyzeGrammarNegation(previous, current, [
      { slug: "stances/bad", dependencies: [{ grammar: "ovsm", stage: "never-existed" }] },
    ]);
    expect(findings).toEqual([]);
  });

  it("emits at most one finding per dependency, preferring removal over re-semanticization", () => {
    const current = withMutation((reg) => {
      // remove the whole stage AND (moot) it would also count as a label change — removal wins
      reg.ovsm.stages = reg.ovsm.stages.filter((s) => s.key !== "retain");
    });
    const findings = analyzeGrammarNegation(previous, current, [
      { slug: "stances/x", dependencies: [{ grammar: "ovsm", stage: "retain", state: "active" }] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].delta).toBe("removed");
  });
});
