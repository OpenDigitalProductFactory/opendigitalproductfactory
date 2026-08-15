import { describe, expect, it } from "vitest";

import { clusterDecisionReviewRowsSemantic, SEMANTIC_CLUSTER_THRESHOLD } from "./review-clustering";

type Row = { id: string; profileId: string; domainClass: string; question: string };

function row(id: string, question: string, domainClass = "risk-assessment"): Row {
  return { id, profileId: "org-1", domainClass, question };
}

/**
 * Deterministic fake embedder: maps a question onto a unit vector by keyword, so
 * "same topic" pairs land close and unrelated ones land orthogonal. Keeps these
 * tests independent of the real embedding model.
 */
function fakeEmbed(vectors: Record<string, number[]>) {
  return async (text: string): Promise<number[] | null> => {
    const key = Object.keys(vectors).find((k) => text.toLowerCase().includes(k));
    return key ? vectors[key]! : [0, 0, 1];
  };
}

const TOPIC = fakeEmbed({
  toaster: [1, 0, 0],
  msp: [0, 1, 0],
});

describe("semantic review clustering (BI-932C2A81)", () => {
  it("collapses paraphrases of the same decision into one cluster", async () => {
    const rows = [
      row("a", "Should we start manufacturing and selling physical kitchen toasters to Alaskan fishermen?"),
      row("b", "Should we pursue selling toasters to fishermen from kiosks on the fishing docks in Alaska?"),
    ];
    const { clusters, method } = await clusterDecisionReviewRowsSemantic(rows, { embed: TOPIC });

    expect(method).toBe("semantic");
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.occurrenceCount).toBe(2);
    expect(clusters[0]!.members.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  it("keeps the newest row as the representative", async () => {
    const rows = [row("newest", "toaster kiosks?"), row("older", "toaster manufacturing?")];
    const { clusters } = await clusterDecisionReviewRowsSemantic(rows, { embed: TOPIC });
    expect(clusters[0]!.representative.id).toBe("newest");
  });

  it("does NOT merge unrelated decisions", async () => {
    const rows = [row("t", "toaster line?"), row("m", "onboard an MSP reseller?")];
    const { clusters } = await clusterDecisionReviewRowsSemantic(rows, { embed: TOPIC });
    expect(clusters).toHaveLength(2);
  });

  // BI-F5F2869D made domainClass a prior rather than a gate; the same business
  // question can be bucketed differently by different callers, so clustering
  // must not re-impose the split that fix removed.
  it("clusters across differing domainClass", async () => {
    const rows = [
      row("a", "onboard an MSP reseller partner?", "risk-assessment"),
      row("b", "should we onboard an MSP as a certified partner?", "plan-readiness"),
    ];
    const { clusters } = await clusterDecisionReviewRowsSemantic(rows, { embed: TOPIC });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.occurrenceCount).toBe(2);
  });

  it("never clusters across profiles", async () => {
    const rows = [
      { ...row("a", "toaster?"), profileId: "org-1" },
      { ...row("b", "toaster?"), profileId: "org-2" },
    ];
    const { clusters } = await clusterDecisionReviewRowsSemantic(rows, { embed: TOPIC });
    expect(clusters).toHaveLength(2);
  });

  // The safety contract. One answer closes every member of its cluster, so an
  // unavailable embedding layer must NOT silently widen what a single answer
  // resolves — it falls back to proven exact-lexical identity, matching the
  // BI-7E1F128A fail-safe posture.
  it("falls back to exact-lexical identity when embeddings are unavailable", async () => {
    const rows = [
      row("a", "Should we sell toasters in Alaska?"),
      row("b", "Should we sell  TOASTERS in alaska?"),
      row("c", "Should we manufacture toasters instead?"),
    ];
    const { clusters, method } = await clusterDecisionReviewRowsSemantic(rows, {
      embed: async () => null,
    });

    expect(method).toBe("lexical");
    // a and b differ only by case/whitespace — provably the same string.
    // c is a different question and must stay separate.
    expect(clusters).toHaveLength(2);
    expect(clusters.find((c) => c.occurrenceCount === 2)!.members.map((m) => m.id).sort())
      .toEqual(["a", "b"]);
  });

  it("treats a below-threshold similarity as distinct", async () => {
    const near = fakeEmbed({ toaster: [1, 0, 0], kiosk: [0.8, 0.6, 0] });
    const rows = [row("a", "toaster line?"), row("b", "kiosk placement?")];
    const { clusters } = await clusterDecisionReviewRowsSemantic(rows, { embed: near });
    // cos = 0.8, below the threshold — must not merge.
    expect(SEMANTIC_CLUSTER_THRESHOLD).toBeGreaterThan(0.8);
    expect(clusters).toHaveLength(2);
  });

  it("returns an empty list for no rows", async () => {
    const { clusters } = await clusterDecisionReviewRowsSemantic([], { embed: TOPIC });
    expect(clusters).toEqual([]);
  });
});
