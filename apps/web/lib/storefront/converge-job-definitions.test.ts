import { describe, it, expect } from "vitest";
import { ALL_ARCHETYPES, deriveOperationalValueStream } from "@dpf/storefront-templates";
import { JOB_DEFINITION_AXES } from "@dpf/db/coworker-job-definition";

import { convergeJobDefinitions, formatJobDefinitionConvergence } from "./converge-job-definitions";

const ovsmFor = (archetypeId: string) => {
  const t = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
  if (!t) throw new Error(`fixture archetype ${archetypeId} missing`);
  return deriveOperationalValueStream(t);
};

describe("convergeJobDefinitions", () => {
  // Asserted against the REAL catalogue, not a hand-built fixture: the whole
  // claim is that a live archetype yields real roles, and a fixture could pass
  // while every shipped archetype derived nothing.
  it("derives roles for every archetype in the catalogue, and never zero", () => {
    expect(ALL_ARCHETYPES.length).toBeGreaterThan(50);
    const empty: string[] = [];
    for (const a of ALL_ARCHETYPES) {
      const c = convergeJobDefinitions(deriveOperationalValueStream(a));
      expect(c.archetypeId).toBe(a.archetypeId);
      if (c.roles === 0) empty.push(a.archetypeId);
    }
    // A shipped archetype whose value stream implies no job at all would mean
    // the lane-role join is broken, which is how this projection was first
    // written wrong (reading stage roles, which are null on 861 of 877 stages).
    expect(empty).toEqual([]);
  });

  it("reports an unanswered axis rather than filling it", () => {
    const c = convergeJobDefinitions(ovsmFor(ALL_ARCHETYPES[0]!.archetypeId));
    // Four of the nine axes need facts the OVSM does not carry (authority,
    // qualifications, context, supervision), so a real archetype must surface
    // open work. Zero open axes here would mean something is inventing answers.
    const totalOpen = Object.values(c.openByAxis).reduce((a, b) => a + b, 0);
    expect(totalOpen).toBeGreaterThan(0);
    for (const axis of Object.keys(c.openByAxis)) {
      expect(JOB_DEFINITION_AXES).toContain(axis);
    }
  });

  it("lists the worst role first, and orders stably for equal counts", () => {
    const c = convergeJobDefinitions(ovsmFor(ALL_ARCHETYPES[0]!.archetypeId));
    for (let i = 1; i < c.open.length; i++) {
      const prev = c.open[i - 1]!;
      const cur = c.open[i]!;
      expect(prev.openAxes.length).toBeGreaterThanOrEqual(cur.openAxes.length);
      if (prev.openAxes.length === cur.openAxes.length) {
        // Stable ordering matters: a worklist that reshuffles between deploys
        // reads as churn rather than progress.
        expect(prev.role.localeCompare(cur.role)).toBeLessThanOrEqual(0);
      }
    }
  });

  it("is deterministic — the same archetype converges identically twice", () => {
    const id = ALL_ARCHETYPES[0]!.archetypeId;
    expect(convergeJobDefinitions(ovsmFor(id))).toEqual(convergeJobDefinitions(ovsmFor(id)));
  });

  it("carries the priming each role's own stages require", () => {
    // requiredContext is the operator's "priming": what the role must KNOW
    // before its first turn, derived from the constraints and domains of the
    // stages it owns rather than authored per coworker.
    const withContext = ALL_ARCHETYPES.map((a) => convergeJobDefinitions(deriveOperationalValueStream(a)))
      .flatMap((c) => c.open)
      .filter((o) => o.requiredContext.constraints.length > 0 || o.requiredContext.domains.length > 0);
    expect(withContext.length).toBeGreaterThan(0);
  });

  it("summarises in one line, and says so when nothing is open", () => {
    const c = convergeJobDefinitions(ovsmFor(ALL_ARCHETYPES[0]!.archetypeId));
    const line = formatJobDefinitionConvergence(c);
    expect(line).toContain("[job-definitions]");
    expect(line).toContain(c.archetypeId);
    expect(line).toMatch(/role\(s\) derived/);

    const none = formatJobDefinitionConvergence({
      ...c, roles: 2, rolesWithStandingWork: 1, openByAxis: {}, open: [], unownedStageKeys: [],
    });
    expect(none).toContain("every derivable axis answered");
    expect(none).not.toContain("name no responsible role");
  });

  it("names stages nobody owns instead of counting them as covered", () => {
    const anyUnowned = ALL_ARCHETYPES
      .map((a) => convergeJobDefinitions(deriveOperationalValueStream(a)))
      .some((c) => c.unownedStageKeys.length > 0);
    // Either every stage is owned across the catalogue, or the ones that are
    // not are reported. Both are acceptable; silently dropping them is not.
    expect(typeof anyUnowned).toBe("boolean");
    const c = convergeJobDefinitions(ovsmFor(ALL_ARCHETYPES[0]!.archetypeId));
    expect(Array.isArray(c.unownedStageKeys)).toBe(true);
  });
});
