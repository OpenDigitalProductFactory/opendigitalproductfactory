import { beforeEach, describe, expect, it, vi } from "vitest";

// BET-5: structural relationship health now reads from the Postgres graph
// mirror via prisma.$queryRawUnsafe (grouping graph_edge by rel_type) instead
// of running Cypher.
const { mockQueryRawUnsafe } = vi.hoisted(() => ({
  mockQueryRawUnsafe: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    $queryRawUnsafe: mockQueryRawUnsafe,
    codeGraphIndexState: {
      findUnique: vi.fn(),
    },
    codeGraphFileHash: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  getCodeGraphFreshness,
  summarizeCodeGraphCoverage,
} from "./code-graph-access";

beforeEach(() => {
  vi.clearAllMocks();
  mockQueryRawUnsafe.mockResolvedValue([]);
});

describe("getCodeGraphFreshness", () => {
  it("returns missing state when no graph index exists", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue(null);

    const result = await getCodeGraphFreshness("source-code", {
      now: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(result.available).toBe(false);
    expect(result.indexStatus).toBe("missing");
    expect(result.summary).toContain("not been built yet");
    expect(result.trust?.action).toBe("refresh-required");
  });

  it("surfaces warnings for dirty or non-ready workspaces", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue({
      graphKey: "source-code",
      graphVersion: 1,
      indexStatus: "ready",
      workspaceRoot: "/workspace",
      lastIndexedAt: new Date("2026-04-20T00:00:00.000Z"),
      lastIndexedBranch: "main",
      lastIndexedHeadSha: "abc123",
      workspaceDirty: true,
      workspaceDirtyObservedAt: new Date("2026-04-20T00:05:00.000Z"),
      indexedFileCount: 42,
      lastError: null,
    } as never);

    const result = await getCodeGraphFreshness("source-code", {
      now: new Date("2026-04-20T01:00:00.000Z"),
    });

    expect(result.available).toBe(true);
    expect(result.indexStatus).toBe("ready");
    expect(result.warnings).toContain("Uncommitted local changes may not be reflected in graph-backed analysis.");
    expect(result.trust?.primaryRationale).toContain("Uncommitted local changes");
  });

  it("adds stale trust metadata when the ready graph is older than seven days", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue({
      graphKey: "source-code",
      graphVersion: 1,
      indexStatus: "ready",
      workspaceRoot: "/workspace",
      lastIndexedAt: new Date("2026-05-10T12:00:00.000Z"),
      lastIndexedBranch: "main",
      lastIndexedHeadSha: "abc123",
      workspaceDirty: false,
      workspaceDirtyObservedAt: null,
      indexedFileCount: 42,
      lastError: null,
    } as never);

    const result = await getCodeGraphFreshness("source-code", {
      now: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(result.trust?.statementKind).toBe("last-known-fact");
    expect(result.trust?.primaryRationale).toContain("16 days");
  });

  it("can inspect structural relationship health for realistic benchmark readiness", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue({
      graphKey: "source-code",
      graphVersion: 2,
      indexStatus: "ready",
      workspaceRoot: "/workspace",
      lastIndexedAt: new Date("2026-05-13T00:00:00.000Z"),
      lastIndexedBranch: "main",
      lastIndexedHeadSha: "abc123",
      workspaceDirty: false,
      workspaceDirtyObservedAt: null,
      indexedFileCount: 42,
      lastError: null,
    } as never);
    mockQueryRawUnsafe.mockResolvedValue([
      { relationship: "DEFINES", count: 10 },
      { relationship: "IMPORTS", count: 20 },
    ]);

    const result = await getCodeGraphFreshness("source-code", {
      inspectStructuralHealth: true,
      now: new Date("2026-05-13T01:00:00.000Z"),
    });

    expect(result.relationshipCounts).toEqual({
      DEFINES: 10,
      IMPORTS: 20,
      IMPLEMENTS_ROUTE: 0,
      EXPOSES_TOOL: 0,
      TESTED_BY: 0,
    });
    expect(result.warnings).toContain(
      "Code graph structural relationships are missing: IMPLEMENTS_ROUTE, EXPOSES_TOOL, TESTED_BY.",
    );
  });
});

describe("summarizeCodeGraphCoverage", () => {
  it("reports which changed files are indexed by the current graph snapshot", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue({
      graphKey: "source-code",
      graphVersion: 1,
      indexStatus: "ready",
      workspaceRoot: "/workspace",
      lastIndexedAt: new Date("2026-04-20T00:00:00.000Z"),
      lastIndexedBranch: "main",
      lastIndexedHeadSha: "abc123",
      workspaceDirty: false,
      workspaceDirtyObservedAt: null,
      indexedFileCount: 42,
      lastError: null,
    } as never);
    vi.mocked(prisma.codeGraphFileHash.findMany).mockResolvedValue([
      { filePath: "apps/web/lib/integrate/change-impact.ts" },
    ] as never);

    const result = await summarizeCodeGraphCoverage([
      "apps/web/lib/integrate/change-impact.ts",
      "apps/web/lib/integrate/new-file.ts",
    ], "source-code", {
      now: new Date("2026-04-20T01:00:00.000Z"),
    });

    expect(result.indexedFiles).toEqual(["apps/web/lib/integrate/change-impact.ts"]);
    expect(result.unindexedFiles).toEqual(["apps/web/lib/integrate/new-file.ts"]);
    expect(result.summary).toContain("1/2 changed files");
    expect(result.trust?.action).toBe("qualify");
  });
});
