import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
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
});

describe("getCodeGraphFreshness", () => {
  it("returns missing state when no graph index exists", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue(null);

    const result = await getCodeGraphFreshness();

    expect(result.available).toBe(false);
    expect(result.indexStatus).toBe("missing");
    expect(result.summary).toContain("not been built yet");
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

    const result = await getCodeGraphFreshness();

    expect(result.available).toBe(true);
    expect(result.indexStatus).toBe("ready");
    expect(result.warnings).toContain("Uncommitted local changes may not be reflected in graph-backed analysis.");
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
    ]);

    expect(result.indexedFiles).toEqual(["apps/web/lib/integrate/change-impact.ts"]);
    expect(result.unindexedFiles).toEqual(["apps/web/lib/integrate/new-file.ts"]);
    expect(result.summary).toContain("1/2 changed files");
  });
});
