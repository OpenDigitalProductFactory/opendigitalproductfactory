import { describe, expect, it } from "vitest";

import { countCategories, orderForFullList } from "./classify";
import { parseCommit } from "./conventional";
import type { RawCommit } from "./types";

function raw(subject: string, date = "2026-05-01T00:00:00Z"): RawCommit {
  return {
    sha: "0000000000000000000000000000000000000000",
    subject,
    author: "Test",
    authorDate: date,
    files: [],
  };
}

describe("countCategories", () => {
  it("buckets parsed commits and reports a total", () => {
    const commits = [
      parseCommit(raw("feat: a")),
      parseCommit(raw("feat: b")),
      parseCommit(raw("fix: c")),
      parseCommit(raw("perf: d")),
      parseCommit(raw("docs: e")),
      parseCommit(raw("feat!: f")),
    ];
    expect(countCategories(commits)).toEqual({
      breaking: 1,
      feature: 2,
      fix: 1,
      performance: 1,
      other: 1,
      total: 6,
    });
  });

  it("yields zeros and total=0 for empty input", () => {
    expect(countCategories([])).toEqual({
      breaking: 0, feature: 0, fix: 0, performance: 0, other: 0, total: 0,
    });
  });
});

describe("orderForFullList", () => {
  it("orders breaking → feature → perf → fix → other, newest first within bucket", () => {
    const commits = [
      parseCommit(raw("fix: older", "2026-04-01T00:00:00Z")),
      parseCommit(raw("feat!: breaking new", "2026-04-15T00:00:00Z")),
      parseCommit(raw("feat: new feature", "2026-05-01T00:00:00Z")),
      parseCommit(raw("fix: newer fix", "2026-05-15T00:00:00Z")),
      parseCommit(raw("docs: dox", "2026-05-20T00:00:00Z")),
      parseCommit(raw("perf: fast", "2026-05-10T00:00:00Z")),
    ];
    const ordered = orderForFullList(commits);
    expect(ordered.map((c) => c.category)).toEqual([
      "breaking",
      "feature",
      "performance",
      "fix",
      "fix",
      "other",
    ]);
    // Within the two fixes, newer first.
    expect(ordered[3]!.authorDate).toBe("2026-05-15T00:00:00Z");
    expect(ordered[4]!.authorDate).toBe("2026-04-01T00:00:00Z");
  });
});
