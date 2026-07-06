// BI-5CE7CF0B: a consult where every contribution is zero must not crown a
// winner. Before this fix, decide() ranked by composite and "recommended"
// ranked[0] — input order — at composite 0.000, and the ledger recorded
// "Recommends warn_only (composite 0.000, margin 0.000)" (DI-417AA19D37C9).
// Zero signal is now an explicit no-recommendation outcome the caller and
// the audit surface can name honestly.

import { describe, it, expect } from "vitest";

import { decide, type DecisionPrinciple } from "./option-scoring";

const structuredPrinciple = (id: string): DecisionPrinciple => ({
  id,
  name: `Principle ${id}`,
  tier: "commandment",
  weight: 1,
  dimensionVector: { reusability: 1, governance_compliance: 0.5 },
});

describe("decide() zero-signal guard (BI-5CE7CF0B)", () => {
  it("returns no recommendation when every contribution is zero", () => {
    // Options with no features and no embeddings: structured alignment is 0
    // against every principle, and the semantic path cannot fire.
    const result = decide(
      [
        { id: "warn_only", description: "", features: {} },
        { id: "hard_gate_all", description: "", features: {} },
      ],
      [structuredPrinciple("p1"), structuredPrinciple("p2")],
    );

    expect(result.recommendation).toBeNull();
    expect(result.flags.insufficientSignal).toBe(true);
    expect(result.reasoning).toMatch(/insufficient signal/i);
    // The ledger still gets the full zero ledger for the drill-in.
    expect(result.scores).toHaveLength(2);
  });

  it("still recommends normally when options carry scoreable features", () => {
    const result = decide(
      [
        { id: "a", description: "", features: { reusability: 0.9 } },
        { id: "b", description: "", features: { reusability: 0.1 } },
      ],
      [structuredPrinciple("p1")],
    );

    expect(result.recommendation?.optionId).toBe("a");
    expect(result.flags.insufficientSignal).toBe(false);
  });

  it("offsetting non-zero contributions are signal, not silence", () => {
    // A composite of zero built from real positive and negative pulls is a
    // genuine tie, not an unscored decision — the guard must not fire.
    const result = decide(
      [
        {
          id: "a",
          description: "",
          features: { reusability: 1, governance_compliance: -2 },
        },
        { id: "b", description: "", features: { reusability: 0.5 } },
      ],
      [structuredPrinciple("p1")],
    );

    expect(result.flags.insufficientSignal).toBe(false);
    expect(result.recommendation).not.toBeNull();
  });
});
