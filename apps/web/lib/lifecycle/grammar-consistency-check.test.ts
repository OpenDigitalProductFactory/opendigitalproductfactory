import { describe, expect, it } from "vitest";

import { buildGrammarSnapshot, serializeSnapshot, resolveDependency } from "./grammar-negation";
import { checkGrammarConsistency } from "./grammar-consistency-check";
import { KERNEL_STANCE_DEPENDENCIES } from "./stance-lifecycle-dependencies";

// BI-EAD441E0 slice S2 — behavioral proof of the consistency check + kernel couplings,
// independent of the frozen baseline file (which the sibling guard test pins).

describe("checkGrammarConsistency", () => {
  const liveBaseline = serializeSnapshot(buildGrammarSnapshot());

  it("is in sync and finds nothing when baseline matches the live grammars", () => {
    const r = checkGrammarConsistency(liveBaseline);
    expect(r.inSync).toBe(true);
    expect(r.negating).toEqual([]);
    expect(r.weakening).toEqual([]);
  });

  it("BLOCKS: a current snapshot that removed ovsm::retain negates the recurring-use kernel stance", () => {
    // Build a mutated "current" with the retain stage gone, keeping the real
    // baseline as "previous".
    const mutated = buildGrammarSnapshot();
    for (const key of Object.keys(mutated.stages)) {
      if (key.startsWith("ovsm::retain")) delete mutated.stages[key];
    }
    for (const key of Object.keys(mutated.states)) {
      if (key.startsWith("ovsm::retain::")) delete mutated.states[key];
    }
    const r = checkGrammarConsistency(liveBaseline, KERNEL_STANCE_DEPENDENCIES, mutated);
    expect(r.inSync).toBe(false);
    expect(r.negating).toHaveLength(1);
    expect(r.negating[0]).toMatchObject({
      slug: "stances/how-do-we-manage-the-business-and-what-is-the-goal-of-a-customer-relationship",
      delta: "removed",
      severity: "negating",
    });
  });

  it("throws (fails loud) on an unparseable baseline rather than reporting a clean pass", () => {
    expect(() => checkGrammarConsistency("{ not valid")).toThrow();
  });
});

describe("KERNEL_STANCE_DEPENDENCIES", () => {
  it("every declared kernel coupling resolves against the live grammars", () => {
    // A coupling that points at a non-existent grammar element is dead weight —
    // catch it here so the kernel couplings stay real.
    for (const stance of KERNEL_STANCE_DEPENDENCIES) {
      for (const dep of stance.dependencies) {
        expect(
          resolveDependency(dep),
          `kernel coupling ${stance.slug} -> ${dep.grammar}::${dep.stage}${dep.state ? "::" + dep.state : ""} does not resolve`,
        ).toBe(true);
      }
    }
  });
});
