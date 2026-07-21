import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateArchetypeCompleteness,
  categoriesBelowDepthFloor,
} from "./lib/archetype-completeness.mjs";

// A complete fixture: every category in union + industry, warehousing meets the
// full depth floor, the rest are grandfathered.
function baseInput(overrides = {}) {
  const categories = ["retail-goods", "warehousing-fulfilment", "moving-and-logistics"];
  return {
    categories,
    inUnion: () => true,
    inIndustry: () => true,
    corpusCounts: { "warehousing-fulfilment": 4, "moving-and-logistics": 1 },
    decisions: new Set(["warehousing-fulfilment"]),
    baseline: new Set(["retail-goods", "moving-and-logistics"]),
    ...overrides,
  };
}

describe("archetype completeness gate", () => {
  it("passes when Tier 1 is clean and every non-grandfathered category meets the depth floor", () => {
    const r = evaluateArchetypeCompleteness(baseInput());
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, []);
    assert.equal(r.completeCount, 1); // only warehousing has corpus + decision
  });

  it("TIER 1 blocks ALL categories — a category missing from INDUSTRY_OPTIONS fails even if grandfathered", () => {
    const r = evaluateArchetypeCompleteness(
      baseInput({ inIndustry: (c) => c !== "retail-goods" }),
    );
    assert.equal(r.ok, false);
    const t1 = r.errors.find((e) => e.tier === 1 && e.category === "retail-goods");
    assert.ok(t1, "retail-goods should fail Tier 1");
    assert.ok(t1.missing.some((m) => m.includes("INDUSTRY_OPTIONS")));
  });

  it("TIER 1 blocks a category missing from the ArchetypeCategory union", () => {
    const r = evaluateArchetypeCompleteness(
      baseInput({ inUnion: (c) => c !== "warehousing-fulfilment" }),
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.tier === 1 && e.category === "warehousing-fulfilment"));
  });

  it("TIER 2 blocks a NEW category (not grandfathered) with no corpus and no decision", () => {
    const r = evaluateArchetypeCompleteness(
      baseInput({
        categories: ["warehousing-fulfilment", "pallet-testing-fake"],
        baseline: new Set([]), // pallet-testing-fake is new
      }),
    );
    assert.equal(r.ok, false);
    const t2 = r.errors.find((e) => e.tier === 2 && e.category === "pallet-testing-fake");
    assert.ok(t2, "new shallow category must fail Tier 2");
    assert.ok(t2.missing.some((m) => m.includes("WSID corpus")));
    assert.ok(t2.missing.some((m) => m.includes("coworker decision")));
  });

  it("TIER 2 blocks a new category that has corpus but no recorded coworker decision", () => {
    const r = evaluateArchetypeCompleteness(
      baseInput({
        categories: ["new-cat"],
        corpusCounts: { "new-cat": 2 },
        decisions: new Set([]),
        baseline: new Set([]),
      }),
    );
    assert.equal(r.ok, false);
    const t2 = r.errors.find((e) => e.tier === 2);
    assert.equal(t2.missing.length, 1);
    assert.ok(t2.missing[0].includes("coworker decision"));
  });

  it("TIER 2 does NOT block a grandfathered category with zero corpus (ratchet, not wedge)", () => {
    const r = evaluateArchetypeCompleteness(
      baseInput({
        categories: ["healthcare-wellness"],
        corpusCounts: {},
        decisions: new Set([]),
        baseline: new Set(["healthcare-wellness"]),
      }),
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, []);
  });

  it("surfaces a baselined category that now passes as a ratchet opportunity, not an error", () => {
    const r = evaluateArchetypeCompleteness(
      baseInput({
        categories: ["moving-and-logistics"],
        corpusCounts: { "moving-and-logistics": 3 },
        decisions: new Set(["moving-and-logistics"]),
        baseline: new Set(["moving-and-logistics"]), // still listed but now complete
      }),
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.staleBaseline, ["moving-and-logistics"]);
  });

  it("categoriesBelowDepthFloor returns exactly the categories missing corpus or decision", () => {
    const below = categoriesBelowDepthFloor(
      ["a", "b", "c"],
      { a: 1, b: 0, c: 2 },
      new Set(["a", "c"]),
    );
    // a: corpus+decision -> above; b: no corpus -> below; c: corpus+decision -> above
    assert.deepEqual(below, ["b"]);
  });
});
