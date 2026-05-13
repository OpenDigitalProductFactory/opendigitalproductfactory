import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRunCypher } = vi.hoisted(() => ({
  mockRunCypher: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    codeGraphIndexState: {
      findUnique: vi.fn(),
    },
  },
  runCypher: mockRunCypher,
}));

import { prisma, runCypher } from "@dpf/db";
import { CODE_GRAPH_GRAPH_KEY } from "./constants";
import {
  findRelatedTests,
  searchCodeGraph,
  traceCodeSurface,
} from "./graph-queries";

function makeIndexState(overrides: Record<string, unknown> = {}) {
  return {
    graphKey: CODE_GRAPH_GRAPH_KEY,
    indexStatus: "ready",
    lastIndexedAt: new Date("2026-05-13T12:00:00.000Z"),
    lastIndexedBranch: "main",
    lastIndexedHeadSha: "abc123",
    workspaceDirty: false,
    indexedFileCount: 42,
    lastError: null,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue(makeIndexState());
  vi.mocked(runCypher).mockResolvedValue([]);
});

describe("searchCodeGraph", () => {
  it("searches graph nodes by name and path", async () => {
    vi.mocked(runCypher).mockResolvedValueOnce([
      {
        labels: ["CodeTool"],
        name: "search_code_graph",
        path: "apps/web/lib/mcp-tools.ts",
        startLine: 812,
        endLine: 829,
        extractor: "mcp-tools-ast-v1",
      },
    ]);

    const result = await searchCodeGraph({ query: "code graph", limit: 5 });

    expect(result.available).toBe(true);
    expect(result.results).toEqual([
      {
        kind: "CodeTool",
        name: "search_code_graph",
        path: "apps/web/lib/mcp-tools.ts",
        startLine: 812,
        endLine: 829,
        extractor: "mcp-tools-ast-v1",
      },
    ]);
    expect(runCypher).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT 5"),
      expect.objectContaining({
        graphKey: CODE_GRAPH_GRAPH_KEY,
        query: "code graph",
      }),
    );
  });

  it("uses a bounded integer literal for Neo4j LIMIT clauses", async () => {
    await searchCodeGraph({ query: "code graph", limit: 10.9 });

    expect(runCypher).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT 10"),
      expect.not.objectContaining({ limit: expect.anything() }),
    );
  });

  it("does not query Neo4j when the graph is missing", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValueOnce(null);

    const result = await searchCodeGraph({ query: "build" });

    expect(result.available).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.summary).toContain("has not been built");
    expect(runCypher).not.toHaveBeenCalled();
  });

  it("does not query Neo4j when the graph failed", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValueOnce(
      makeIndexState({
        indexStatus: "failed",
        lastError: "Neo4j unavailable",
      }),
    );

    const result = await searchCodeGraph({ query: "build" });

    expect(result.available).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.summary).toContain("failed");
    expect(runCypher).not.toHaveBeenCalled();
  });
});

describe("traceCodeSurface", () => {
  it("traces a route to implementation files and related tests", async () => {
    vi.mocked(runCypher).mockResolvedValueOnce([
      {
        surfaceLabels: ["CodeRoute"],
        surfaceName: "/build",
        surfacePath: "apps/web/app/build/page.tsx",
        surfaceStartLine: null,
        surfaceEndLine: null,
        implementationFiles: [
          {
            path: "apps/web/app/build/page.tsx",
            relationship: "IMPLEMENTS_ROUTE",
          },
        ],
        relatedTests: [
          {
            path: "apps/web/components/build/BuildStudio.test.tsx",
            confidence: "exact",
          },
        ],
      },
    ]);

    const result = await traceCodeSurface({ route: "/build" });

    expect(result.available).toBe(true);
    expect(result.selector).toEqual({ kind: "route", value: "/build" });
    expect(result.surface).toEqual({
      kind: "CodeRoute",
      name: "/build",
      path: "apps/web/app/build/page.tsx",
      startLine: null,
      endLine: null,
    });
    expect(result.implementationFiles).toEqual([
      {
        path: "apps/web/app/build/page.tsx",
        relationship: "IMPLEMENTS_ROUTE",
      },
    ]);
    expect(result.relatedTests).toEqual([
      {
        path: "apps/web/components/build/BuildStudio.test.tsx",
        confidence: "exact",
      },
    ]);
  });
});

describe("findRelatedTests", () => {
  it("returns tests linked to a source file", async () => {
    vi.mocked(runCypher).mockResolvedValueOnce([
      {
        path: "apps/web/lib/integrate/code-graph/graph-queries.test.ts",
        name: "graph-queries.test.ts",
        confidence: "exact",
        startLine: 7,
        endLine: 7,
      },
    ]);

    const result = await findRelatedTests({
      filePath: "apps/web/lib/integrate/code-graph/graph-queries.ts",
    });

    expect(result.available).toBe(true);
    expect(result.tests).toEqual([
      {
        path: "apps/web/lib/integrate/code-graph/graph-queries.test.ts",
        name: "graph-queries.test.ts",
        confidence: "exact",
        startLine: 7,
        endLine: 7,
      },
    ]);
    expect(runCypher).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT 25"),
      expect.objectContaining({
        graphKey: CODE_GRAPH_GRAPH_KEY,
        filePath: "apps/web/lib/integrate/code-graph/graph-queries.ts",
      }),
    );
  });

  it("uses a bounded integer literal when finding tests", async () => {
    await findRelatedTests({
      filePath: "apps/web/lib/integrate/code-graph/graph-queries.ts",
      limit: 99.1,
    });

    expect(runCypher).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT 50"),
      expect.not.objectContaining({ limit: expect.anything() }),
    );
  });
});
