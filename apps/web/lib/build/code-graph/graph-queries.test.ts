import { beforeEach, describe, expect, it, vi } from "vitest";

// BET-5: graph-queries now reads the Postgres graph mirror via
// prisma.$queryRawUnsafe (parameterised SQL over graph_node / graph_edge)
// instead of running Cypher. The bounded LIMIT is still inlined as an integer
// literal (not a bound param); the graphKey/labels/query values are positional
// params. traceCodeSurface issues three sequential queries (surface → impl
// files → related tests) where Cypher used one combined statement.
const { mockQueryRawUnsafe } = vi.hoisted(() => ({
  mockQueryRawUnsafe: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    $queryRawUnsafe: mockQueryRawUnsafe,
    codeGraphIndexState: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
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
  mockQueryRawUnsafe.mockResolvedValue([]);
});

describe("searchCodeGraph", () => {
  it("searches graph nodes by name and path", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([
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
    expect(mockQueryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT 5"),
      CODE_GRAPH_GRAPH_KEY,
      expect.any(Array),
      "code graph",
    );
  });

  it("uses a bounded integer literal for the SQL LIMIT clause", async () => {
    await searchCodeGraph({ query: "code graph", limit: 10.9 });

    // Limit is truncated and inlined into the SQL, never passed as a bound param.
    expect(mockQueryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT 10"),
      CODE_GRAPH_GRAPH_KEY,
      expect.any(Array),
      "code graph",
    );
    const passedParams = mockQueryRawUnsafe.mock.calls[0]!.slice(1);
    expect(passedParams).not.toContain(10);
    expect(passedParams).not.toContain(10.9);
  });

  it("does not query the graph when the graph is missing", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValueOnce(null);

    const result = await searchCodeGraph({ query: "build" });

    expect(result.available).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.summary).toContain("has not been built");
    expect(mockQueryRawUnsafe).not.toHaveBeenCalled();
  });

  it("does not query the graph when the index failed", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValueOnce(
      makeIndexState({
        indexStatus: "failed",
        lastError: "graph mirror unavailable",
      }),
    );

    const result = await searchCodeGraph({ query: "build" });

    expect(result.available).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.summary).toContain("failed");
    expect(mockQueryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe("traceCodeSurface", () => {
  it("traces a route to implementation files and related tests", async () => {
    mockQueryRawUnsafe
      // 1. surface node lookup
      .mockResolvedValueOnce([
        {
          key: "route:/build",
          surfaceLabels: ["CodeRoute"],
          surfaceName: "/build",
          surfacePath: "apps/web/app/build/page.tsx",
          surfaceStartLine: null,
          surfaceEndLine: null,
        },
      ])
      // 2. implementation files
      .mockResolvedValueOnce([
        {
          fileKey: "file:apps/web/app/build/page.tsx",
          path: "apps/web/app/build/page.tsx",
          relationship: "IMPLEMENTS_ROUTE",
        },
      ])
      // 3. related tests
      .mockResolvedValueOnce([
        {
          path: "apps/web/components/build/BuildStudio.test.tsx",
          confidence: "exact",
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
    mockQueryRawUnsafe.mockResolvedValueOnce([
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
    expect(mockQueryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT 25"),
      CODE_GRAPH_GRAPH_KEY,
      "apps/web/lib/integrate/code-graph/graph-queries.ts",
    );
  });

  it("uses a bounded integer literal when finding tests", async () => {
    await findRelatedTests({
      filePath: "apps/web/lib/integrate/code-graph/graph-queries.ts",
      limit: 99.1,
    });

    expect(mockQueryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT 50"),
      CODE_GRAPH_GRAPH_KEY,
      "apps/web/lib/integrate/code-graph/graph-queries.ts",
    );
    const passedParams = mockQueryRawUnsafe.mock.calls[0]!.slice(1);
    expect(passedParams).not.toContain(50);
    expect(passedParams).not.toContain(99.1);
  });
});
