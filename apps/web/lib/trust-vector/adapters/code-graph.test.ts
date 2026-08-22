import { describe, expect, it } from "vitest";

import {
  buildCodeGraphCoverageTrust,
  buildCodeGraphFreshnessTrust,
} from "./code-graph";

describe("code graph trust adapter", () => {
  it("scores a current ready graph as high-trust current fact", () => {
    const assessment = buildCodeGraphFreshnessTrust({
      graphKey: "source-code",
      available: true,
      indexStatus: "ready",
      lastIndexedAt: new Date("2026-05-26T10:00:00.000Z"),
      workspaceDirty: false,
      indexedFileCount: 42,
      lastError: null,
      asOf: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(assessment.tier).toBe("high");
    expect(assessment.statementKind).toBe("current-fact");
    expect(assessment.action).toBe("present");
  });

  it("marks a graph older than seven days as a last-known fact", () => {
    const assessment = buildCodeGraphFreshnessTrust({
      graphKey: "source-code",
      available: true,
      indexStatus: "ready",
      lastIndexedAt: new Date("2026-05-10T12:00:00.000Z"),
      workspaceDirty: false,
      indexedFileCount: 42,
      lastError: null,
      asOf: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(assessment.statementKind).toBe("last-known-fact");
    expect(assessment.action).toBe("warn-stale");
    expect(assessment.primaryRationale).toContain("16 days");
  });

  it("requires refresh when the graph is missing", () => {
    const assessment = buildCodeGraphFreshnessTrust({
      graphKey: "source-code",
      available: false,
      indexStatus: "missing",
      lastIndexedAt: null,
      workspaceDirty: false,
      indexedFileCount: 0,
      lastError: null,
      asOf: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(assessment.tier).toBe("low");
    expect(assessment.action).toBe("refresh-required");
    expect(assessment.primaryRationale).toContain("not been built");
  });

  it("qualifies impact analysis when only part of the changed-file set is indexed", () => {
    const assessment = buildCodeGraphCoverageTrust({
      graphKey: "source-code",
      available: true,
      indexStatus: "ready",
      indexedFileCount: 1,
      totalFileCount: 2,
      warnings: [],
      asOf: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(assessment.tier).toBe("medium");
    expect(assessment.action).toBe("qualify");
    expect(assessment.primaryRationale).toContain("covers 1/2 changed files");
  });
});

// BI-6CFC5429: freshness used to measure only how recently the INDEXER RAN.
// Live on 2026-08-19 the graph re-indexed a 2026-06-08 commit on branch
// "my-changes" twelve minutes before it was read, and scored Freshness 1.0 /
// "high" — while agent code search returned empty for files that existed.
// A recent index of the wrong tree is not fresh.
describe("code graph freshness vs indexed ref (BI-6CFC5429)", () => {
  const base = {
    graphKey: "source-code",
    available: true as const,
    indexStatus: "ready",
    workspaceDirty: false,
    indexedFileCount: 4406,
    lastError: null,
    asOf: new Date("2026-08-19T18:12:00.000Z"),
  };

  function freshness(assessment: ReturnType<typeof buildCodeGraphFreshnessTrust>) {
    return assessment.dimensions.find((d) => d.key === "freshness");
  }

  it("does not score a minutes-old index of a side branch as fully fresh", () => {
    const assessment = buildCodeGraphFreshnessTrust({
      ...base,
      lastIndexedAt: new Date("2026-08-19T18:00:00.000Z"),
      lastIndexedBranch: "my-changes",
    });

    const dim = freshness(assessment);
    expect(dim?.score).toBeLessThanOrEqual(0.4);
    expect(dim?.rationale).toContain("my-changes");
    expect(dim?.rationale).toContain("not the default branch");
    expect(assessment.tier).not.toBe("high");
  });

  it("still scores a recent index of the default branch as fully fresh", () => {
    const dim = freshness(buildCodeGraphFreshnessTrust({
      ...base,
      lastIndexedAt: new Date("2026-08-19T18:00:00.000Z"),
      lastIndexedBranch: "main",
    }));
    expect(dim?.score).toBe(1);
  });

  it("is unchanged when the branch is unknown — no false alarm", () => {
    const dim = freshness(buildCodeGraphFreshnessTrust({
      ...base,
      lastIndexedAt: new Date("2026-08-19T18:00:00.000Z"),
      lastIndexedBranch: null,
    }));
    expect(dim?.score).toBe(1);
  });
});
