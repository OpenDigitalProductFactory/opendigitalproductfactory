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
