import { describe, expect, it } from "vitest";
import { rankCandidates, type RecommendCandidate } from "./recommend";

const baseDate = new Date("2026-04-25T12:00:00Z");

function candidate(overrides: Partial<RecommendCandidate>): RecommendCandidate {
  return {
    itemId: "BI-DEFAULT",
    title: "Default item",
    status: "open",
    priority: null,
    effortSize: null,
    triageOutcome: null,
    hasActiveBuild: false,
    claimedById: null,
    claimedByAgentId: null,
    epicId: null,
    epicStatus: null,
    hasSpec: false,
    hasPlan: false,
    updatedAt: baseDate,
    ...overrides,
  };
}

describe("rankCandidates — eligibility", () => {
  it("filters out done and deferred items", () => {
    const items = [
      candidate({ itemId: "BI-1", status: "done" }),
      candidate({ itemId: "BI-2", status: "deferred" }),
      candidate({ itemId: "BI-3", status: "open" }),
    ];
    const result = rankCandidates(items);
    expect(result.map((r) => r.itemId)).toEqual(["BI-3"]);
  });

  it("includes triaging items (they are pickable for triage work)", () => {
    const items = [candidate({ itemId: "BI-T", status: "triaging" })];
    expect(rankCandidates(items)).toHaveLength(1);
  });

  it("excludes items claimed by a user", () => {
    const items = [
      candidate({ itemId: "BI-Claimed", claimedById: "user-1" }),
      candidate({ itemId: "BI-Free" }),
    ];
    expect(rankCandidates(items).map((r) => r.itemId)).toEqual(["BI-Free"]);
  });

  it("excludes items claimed by another agent unless forAgentId matches", () => {
    const items = [candidate({ itemId: "BI-Mine", claimedByAgentId: "AGT-100" })];
    expect(rankCandidates(items, { forAgentId: "AGT-100" })).toHaveLength(1);
    expect(rankCandidates(items, { forAgentId: "AGT-999" })).toHaveLength(0);
    expect(rankCandidates(items)).toHaveLength(0);
  });

  it("honours excludeItemIds", () => {
    const items = [
      candidate({ itemId: "BI-A" }),
      candidate({ itemId: "BI-B" }),
    ];
    expect(
      rankCandidates(items, { excludeItemIds: ["BI-A"] }).map((r) => r.itemId),
    ).toEqual(["BI-B"]);
  });
});

describe("rankCandidates — scoring", () => {
  it("ranks an item with a spec above one without", () => {
    const items = [
      candidate({ itemId: "BI-NoSpec", title: "no spec" }),
      candidate({ itemId: "BI-Spec", title: "with spec", hasSpec: true }),
    ];
    const ranked = rankCandidates(items);
    expect(ranked[0]?.itemId).toBe("BI-Spec");
    expect(ranked[0]?.signals.hasSpec).toBe(true);
    expect(ranked[0]?.rationale).toContain("has-spec");
  });

  it("penalises items with active builds", () => {
    const items = [
      candidate({ itemId: "BI-Active", hasActiveBuild: true, hasSpec: true }),
      candidate({ itemId: "BI-Free" }),
    ];
    const ranked = rankCandidates(items);
    expect(ranked[0]?.itemId).toBe("BI-Active");
    expect(ranked[0]?.signals.hasActiveBuild).toBe(true);
    expect(ranked[1]?.itemId).toBe("BI-Free");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("ranks triaged-for-build above untriaged when other signals tie", () => {
    const items = [
      candidate({ itemId: "BI-Untriaged" }),
      candidate({ itemId: "BI-Triaged", triageOutcome: "build" }),
    ];
    const ranked = rankCandidates(items);
    expect(ranked[0]?.itemId).toBe("BI-Triaged");
  });

  it("uses priority as the tie-breaker (lower number = higher priority)", () => {
    const items = [
      candidate({ itemId: "BI-Low", priority: 50 }),
      candidate({ itemId: "BI-High", priority: 10 }),
    ];
    const ranked = rankCandidates(items);
    // Both items gain the same flat +2 priority bonus. Tie-break by priority
    // asc puts the lower-numbered (higher-priority) item first.
    expect(ranked[0]?.itemId).toBe("BI-High");
  });

  it("respects count cap", () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      candidate({ itemId: `BI-${i}`, priority: i }),
    );
    expect(rankCandidates(items, { count: 5 })).toHaveLength(5);
    expect(rankCandidates(items, { count: 999 })).toHaveLength(10);
    expect(rankCandidates(items, { count: 0 })).toHaveLength(1);
  });

  it("returns an empty list when nothing is eligible", () => {
    const items = [candidate({ itemId: "BI-Done", status: "done" })];
    expect(rankCandidates(items)).toEqual([]);
  });
});
