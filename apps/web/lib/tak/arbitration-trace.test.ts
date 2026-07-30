// BI-3E218D80 — arbitration trace contract.
//
// The load-bearing test in this file is the LEAK test: the whole reason this mapper exists
// instead of a JSON.stringify at the call site is that ContextSource.content is recalled
// user facts, page data, and semantic-memory excerpts. If content ever reaches the column,
// the platform has silently created a second, ungoverned retention surface for the same
// sensitive text — so that is asserted against the serialized JSON, not just the object.
import { describe, expect, it } from "vitest";

import { arbitrate, getBudgetForTier, type ContextSource } from "./context-arbitrator";
import { buildArbitrationTrace, traceHasLoss } from "./arbitration-trace";

const SECRET = "PATIENT_SSN_078_05_1120_DO_NOT_PERSIST";

function source(over: Partial<ContextSource> & Pick<ContextSource, "tier" | "source">): ContextSource {
  return {
    priority: 0,
    content: `content for ${over.source}`,
    tokenCount: 100,
    compressible: false,
    ...over,
  } as ContextSource;
}

describe("arbitration trace — records the decision, never the payload", () => {
  it("carries no source content, even when the content is distinctive", () => {
    const budget = getBudgetForTier("basic"); // total 800, l2Budget 0 — forces drops
    const sources: ContextSource[] = [
      source({ tier: "L0", source: "identity", content: SECRET, tokenCount: 50 }),
      source({ tier: "L1", source: "user-facts", content: SECRET, tokenCount: 100 }),
      source({ tier: "L2", source: "semantic-memory", content: SECRET, tokenCount: 400 }),
    ];
    const result = arbitrate(sources, budget);
    const trace = buildArbitrationTrace(result, budget);

    // Assert on the SERIALIZED form — that is what reaches the database column.
    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("content for");
    // And the labels we DO want are present.
    expect(serialized).toContain("identity");
    expect(serialized).toContain("semantic-memory");
  });

  it("omits input-policy fields that are recoverable from code", () => {
    const budget = getBudgetForTier("strong");
    const result = arbitrate([source({ tier: "L1", source: "domain", priority: 3 })], budget);
    const entry = buildArbitrationTrace(result, budget).selected[0];
    expect(Object.keys(entry).sort()).toEqual(["source", "tier", "tokenCount"]);
  });

  it("records every selected and dropped source with its tier and cost", () => {
    const budget = getBudgetForTier("basic"); // l1Budget 175, l2Budget 0
    const sources: ContextSource[] = [
      source({ tier: "L0", source: "identity", tokenCount: 60 }),
      source({ tier: "L1", source: "domain", tokenCount: 150 }),
      source({ tier: "L1", source: "portal-context", tokenCount: 900 }), // cannot fit
    ];
    const trace = buildArbitrationTrace(arbitrate(sources, budget), budget);

    expect(trace.selected.map((s) => s.source)).toEqual(["identity", "domain"]);
    expect(trace.dropped.map((s) => s.source)).toEqual(["portal-context"]);
    expect(trace.dropped[0]).toMatchObject({ tier: "L1", tokenCount: 900 });
  });
});

describe("compression is stated, not inferred", () => {
  // The trace must not deduce degradation from `tokenCount === compressedTokenCount`:
  // that inference lies whenever the two variants cost the same. arbitrate() sets an
  // explicit flag instead, and this pins it.
  it("flags a source whose compressed fallback was substituted", () => {
    const budget = getBudgetForTier("basic"); // l1Budget 175
    const sources: ContextSource[] = [
      source({
        tier: "L1",
        source: "page-data",
        tokenCount: 900,
        compressible: true,
        compressedContent: "short",
        compressedTokenCount: 120,
      }),
    ];
    const trace = buildArbitrationTrace(arbitrate(sources, budget), budget);

    expect(trace.dropped).toHaveLength(0);
    expect(trace.selected[0]).toMatchObject({
      source: "page-data",
      tokenCount: 120,
      usedCompressed: true,
    });
  });

  // `arbitrate` has TWO compression branches (L1 and L2) and no dedicated test file of its
  // own, so both had to be covered here or this change would have edited an untested path.
  // L2 also has the unused-L1-budget rollover, which this exercises incidentally.
  it("flags a compressed L2 source, not just L1", () => {
    const budget = getBudgetForTier("strong"); // l1Budget 800, l2Budget 1575
    const sources: ContextSource[] = [
      source({
        tier: "L2",
        source: "semantic-memory",
        tokenCount: 5000, // exceeds the 1575 + 800 rolled-over ceiling
        compressible: true,
        compressedContent: "short recall",
        compressedTokenCount: 400,
      }),
    ];
    const trace = buildArbitrationTrace(arbitrate(sources, budget), budget);

    expect(trace.dropped).toHaveLength(0);
    expect(trace.selected[0]).toMatchObject({
      source: "semantic-memory",
      tier: "L2",
      tokenCount: 400,
      usedCompressed: true,
    });
  });

  it("leaves the flag absent — not false — when nothing was degraded", () => {
    const budget = getBudgetForTier("frontier");
    const trace = buildArbitrationTrace(
      arbitrate([source({ tier: "L1", source: "domain", tokenCount: 10 })], budget),
      budget,
    );
    expect("usedCompressed" in trace.selected[0]).toBe(false);
  });

  it("still reports a drop when even the compressed variant cannot fit", () => {
    const budget = getBudgetForTier("basic"); // l1Budget 175
    const sources: ContextSource[] = [
      source({
        tier: "L1",
        source: "page-data",
        tokenCount: 900,
        compressible: true,
        compressedContent: "still too big",
        compressedTokenCount: 800,
      }),
    ];
    const trace = buildArbitrationTrace(arbitrate(sources, budget), budget);
    expect(trace.selected).toHaveLength(0);
    // The DROPPED entry reports the full cost, not the compressed one — that is the
    // number that explains why it did not fit.
    expect(trace.dropped[0]).toMatchObject({ source: "page-data", tokenCount: 900 });
  });
});

describe("budget shape and loss predicate", () => {
  it("mirrors the resolved budget so a reader needs no second lookup", () => {
    const budget = getBudgetForTier("strong");
    const trace = buildArbitrationTrace(arbitrate([], budget), budget);
    expect(trace.version).toBe(1);
    expect(trace.modelTier).toBe("strong");
    expect(trace.budget).toEqual({ total: 3000, l0: 625, l1: 800, l2: 1575 });
  });

  it("rounds utilization instead of storing a 17-digit float", () => {
    const budget = getBudgetForTier("strong"); // total 3000
    const trace = buildArbitrationTrace(
      arbitrate([source({ tier: "L0", source: "identity", tokenCount: 1000 })], budget),
      budget,
    );
    // 1000/3000 = 0.3333... -> 0.333
    expect(trace.budgetUtilization).toBe(0.333);
  });

  it("traceHasLoss is true for a drop, true for a compression, false for a clean turn", () => {
    const clean = buildArbitrationTrace(
      arbitrate([source({ tier: "L1", source: "domain", tokenCount: 10 })], getBudgetForTier("frontier")),
      getBudgetForTier("frontier"),
    );
    expect(traceHasLoss(clean)).toBe(false);

    const basic = getBudgetForTier("basic");
    const droppedTrace = buildArbitrationTrace(
      arbitrate([source({ tier: "L1", source: "portal-context", tokenCount: 900 })], basic),
      basic,
    );
    expect(traceHasLoss(droppedTrace)).toBe(true);

    const compressedTrace = buildArbitrationTrace(
      arbitrate(
        [source({
          tier: "L1", source: "page-data", tokenCount: 900,
          compressible: true, compressedContent: "s", compressedTokenCount: 120,
        })],
        basic,
      ),
      basic,
    );
    expect(traceHasLoss(compressedTrace)).toBe(true);
  });
});
