import { describe, expect, it } from "vitest";
import { rankMatches, scoreKeywordMatch } from "./portfolio-search";

describe("scoreKeywordMatch", () => {
  it("returns 0 for no match", () => {
    expect(scoreKeywordMatch("finance", "customer portal", null)).toBe(0);
  });
  it("scores name match higher than description match", () => {
    const nameScore = scoreKeywordMatch("finance", "Finance Hub", null);
    const descScore = scoreKeywordMatch("finance", "Portal", "handles finance operations");
    expect(nameScore).toBeGreaterThan(descScore);
  });
  it("scores exact name match highest", () => {
    const exact = scoreKeywordMatch("finance", "Finance", null);
    const partial = scoreKeywordMatch("finance", "Financial Management", null);
    expect(exact).toBeGreaterThan(partial);
  });
  it("is case-insensitive", () => {
    expect(scoreKeywordMatch("FINANCE", "finance hub", null)).toBeGreaterThan(0);
  });
  it("matches multiple keywords independently", () => {
    const single = scoreKeywordMatch("finance", "Finance Hub", null);
    const multi = scoreKeywordMatch("finance management", "Finance Management Hub", null);
    expect(multi).toBeGreaterThan(single);
  });
});

describe("rankMatches", () => {
  it("sorts by relevanceScore descending", () => {
    const matches = [
      { id: "a", name: "Low", description: null, relevanceScore: 1 },
      { id: "b", name: "High", description: null, relevanceScore: 5 },
      { id: "c", name: "Mid", description: null, relevanceScore: 3 },
    ];
    const ranked = rankMatches(matches);
    expect(ranked[0]!.id).toBe("b");
    expect(ranked[1]!.id).toBe("c");
    expect(ranked[2]!.id).toBe("a");
  });
  it("limits results to maxResults", () => {
    const matches = Array.from({ length: 10 }, (_, i) => ({
      id: String(i), name: `Item ${i}`, description: null, relevanceScore: i,
    }));
    expect(rankMatches(matches, 3)).toHaveLength(3);
  });
  it("filters out zero-score matches", () => {
    const matches = [
      { id: "a", name: "Match", description: null, relevanceScore: 5 },
      { id: "b", name: "None", description: null, relevanceScore: 0 },
    ];
    expect(rankMatches(matches)).toHaveLength(1);
  });
});
