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
      parseCommit(raw("build(deps): bump next from 16.2.12 to 16.3.0")),
      parseCommit(raw("chore: h")),
      parseCommit(raw("Unparseable subject line")),
    ];
    expect(countCategories(commits)).toEqual({
      breaking: 1,
      security: 0,
      feature: 2,
      fix: 1,
      performance: 1,
      dependency: 1,
      documentation: 1,
      maintenance: 1,
      other: 1,
      total: 9,
    });
  });

  it("yields zeros and total=0 for empty input", () => {
    expect(countCategories([])).toEqual({
      breaking: 0,
      security: 0,
      feature: 0,
      fix: 0,
      performance: 0,
      dependency: 0,
      documentation: 0,
      maintenance: 0,
      other: 0,
      total: 0,
    });
  });
});

describe("orderForFullList", () => {
  it("ranks the upkeep buckets below the changes an operator asked for", () => {
    const commits = [
      parseCommit(raw("chore: tidy", "2026-05-01T00:00:00Z")),
      parseCommit(raw("docs: explain", "2026-05-02T00:00:00Z")),
      parseCommit(raw("build(deps-dev): bump vitest", "2026-05-03T00:00:00Z")),
      parseCommit(raw("fix: a real fix", "2026-05-04T00:00:00Z")),
    ];
    expect(orderForFullList(commits).map((c) => c.category)).toEqual([
      "fix",
      "dependency",
      "documentation",
      "maintenance",
    ]);
  });

  it("orders breaking → feature → perf → fix → docs, newest first within bucket", () => {
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
      "documentation",
    ]);
    // Within the two fixes, newer first.
    expect(ordered[3]!.authorDate).toBe("2026-05-15T00:00:00Z");
    expect(ordered[4]!.authorDate).toBe("2026-04-01T00:00:00Z");
  });
});
