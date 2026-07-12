import { describe, expect, it } from "vitest";
import {
  computeMerge,
  diceSimilarity,
  findDuplicateCandidates,
  findDuplicatePairs,
  itemSimilarity,
  trigrams,
  type DedupItem,
} from "./dedup";

describe("diceSimilarity", () => {
  it("is 1 for identical (normalized) text and 0 for disjoint", () => {
    expect(diceSimilarity("Add SSO login", "add sso login")).toBe(1);
    expect(diceSimilarity("apples", "zzzzzz")).toBe(0);
  });

  it("scores near-duplicates high and unrelated low", () => {
    const near = diceSimilarity("Add dark mode to settings", "Add a dark-mode toggle in settings");
    const far = diceSimilarity("Add dark mode to settings", "Fix invoice PDF export");
    expect(near).toBeGreaterThan(0.4);
    expect(far).toBeLessThan(0.2);
    expect(near).toBeGreaterThan(far);
  });

  it("handles short strings without crashing", () => {
    expect(trigrams("ab").size).toBe(1);
    expect(diceSimilarity("ab", "ab")).toBe(1);
  });
});

describe("itemSimilarity", () => {
  it("is title-dominant but uses the body signal", () => {
    const a: DedupItem = { itemId: "A", title: "Export report to CSV", body: "users want a csv download" };
    const b: DedupItem = { itemId: "B", title: "Export report to CSV", body: "totally different body text here" };
    const c: DedupItem = { itemId: "C", title: "Export report to CSV", body: "users want a csv download" };
    // Same title → high; identical body raises it above differing body.
    expect(itemSimilarity(a, c)).toBeGreaterThan(itemSimilarity(a, b));
  });
});

describe("findDuplicateCandidates", () => {
  it("returns above-threshold matches, most-similar first, excluding self", () => {
    const target: DedupItem = { itemId: "T", title: "Add CSV export to the reports page" };
    const items: DedupItem[] = [
      { itemId: "T", title: "Add CSV export to the reports page" }, // self — excluded
      { itemId: "D1", title: "Add a CSV export on the reports page" }, // near dup
      { itemId: "D2", title: "Export reports as CSV" }, // related
      { itemId: "X", title: "Rotate the database backups nightly" }, // unrelated
    ];
    const out = findDuplicateCandidates(target, items, 0.4);
    expect(out.map((c) => c.itemId)).not.toContain("T");
    expect(out.map((c) => c.itemId)).not.toContain("X");
    expect(out[0].itemId).toBe("D1"); // most similar first
    expect(out[0].similarity).toBeGreaterThanOrEqual(out[out.length - 1].similarity);
  });
});

describe("findDuplicatePairs", () => {
  it("returns above-threshold pairs across the set, most-similar first", () => {
    const items: DedupItem[] = [
      { itemId: "A", title: "Add CSV export to reports" },
      { itemId: "B", title: "Add a CSV export on reports" }, // ~dup of A
      { itemId: "C", title: "Rotate database backups nightly" },
      { itemId: "D", title: "Rotate the DB backups every night" }, // ~dup of C
    ];
    const pairs = findDuplicatePairs(items, 0.4);
    // A-B and C-D should surface; A-C should not.
    const keys = pairs.map((p) => [p.a, p.b].sort().join("-"));
    expect(keys).toContain("A-B");
    expect(keys).toContain("C-D");
    expect(keys).not.toContain("A-C");
    // sorted desc
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i - 1].similarity).toBeGreaterThanOrEqual(pairs[i].similarity);
    }
  });

  it("returns nothing when all items are distinct", () => {
    expect(
      findDuplicatePairs(
        [
          { itemId: "A", title: "alpha one" },
          { itemId: "B", title: "zulu nine" },
        ],
        0.5,
      ),
    ).toEqual([]);
  });
});

describe("computeMerge", () => {
  it("sums reach so signal concentrates on the survivor", () => {
    expect(computeMerge({ survivorOccurrenceCount: 3, duplicateOccurrenceCount: 2 }).mergedOccurrenceCount).toBe(5);
  });

  it("defaults non-finite counts sensibly (each unknown item counts once)", () => {
    // survivor defaults to 1, duplicate defaults to 1 → merged 2 occurrences.
    expect(computeMerge({ survivorOccurrenceCount: NaN, duplicateOccurrenceCount: NaN }).mergedOccurrenceCount).toBe(2);
  });
});
