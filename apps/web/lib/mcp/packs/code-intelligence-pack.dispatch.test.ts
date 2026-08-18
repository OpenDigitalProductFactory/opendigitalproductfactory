import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindRelatedTests,
  mockGetCodeGraphFreshness,
  mockSearchCodeGraph,
  mockTraceCodeSurface,
} = vi.hoisted(() => ({
  mockFindRelatedTests: vi.fn(),
  mockGetCodeGraphFreshness: vi.fn(),
  mockSearchCodeGraph: vi.fn(),
  mockTraceCodeSurface: vi.fn(),
}));

vi.mock("@/lib/integrate/code-graph/graph-queries", () => ({
  findRelatedTests: mockFindRelatedTests,
  searchCodeGraph: mockSearchCodeGraph,
  traceCodeSurface: mockTraceCodeSurface,
}));

vi.mock("@/lib/integrate/code-graph-access", () => ({
  getCodeGraphFreshness: mockGetCodeGraphFreshness,
}));

import { executeTool } from "@/lib/mcp-tools";
import { buildCodeGraphFreshnessTrust } from "@/lib/trust-vector/adapters/code-graph";

const unavailableResult = {
  graphKey: "dpf-source",
  available: false,
  indexStatus: "missing",
  warnings: ["The code graph has not been built yet."],
  summary: "Code graph has not been built yet for this workspace.",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("code graph MCP handlers", () => {
  it("returns trust metadata and stale wording for code graph freshness", async () => {
    const trust = buildCodeGraphFreshnessTrust({
      graphKey: "source-code",
      available: true,
      indexStatus: "ready",
      lastIndexedAt: new Date("2026-05-10T12:00:00.000Z"),
      workspaceDirty: false,
      indexedFileCount: 42,
      lastError: null,
      asOf: new Date("2026-05-26T12:00:00.000Z"),
    });
    mockGetCodeGraphFreshness.mockResolvedValueOnce({
      graphKey: "source-code",
      available: true,
      indexStatus: "ready",
      lastIndexedAt: new Date("2026-05-10T12:00:00.000Z"),
      lastIndexedBranch: "main",
      lastIndexedHeadSha: "abc123",
      workspaceDirty: false,
      indexedFileCount: 42,
      lastError: null,
      warnings: [],
      summary: "Code graph is ready for 42 indexed files.",
      trust,
    });

    const result = await executeTool("get_code_graph_freshness", {}, "user-1");

    expect(result.success).toBe(true);
    expect(result.message).toContain("Code graph index is 16 days old.");
    expect(result.data).toEqual(expect.objectContaining({
      trust: expect.objectContaining({ tier: "low" }),
    }));
  });

  it("returns failure when graph search cannot read the graph", async () => {
    mockSearchCodeGraph.mockResolvedValueOnce({
      ...unavailableResult,
      query: "build",
      results: [],
    });

    const result = await executeTool("search_code_graph", { query: "build" }, "user-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Code graph unavailable");
    expect(result.message).toBe(unavailableResult.summary);
    expect(result.data).toEqual(expect.objectContaining({ available: false }));
  });

  it("returns failure when surface tracing cannot read the graph", async () => {
    mockTraceCodeSurface.mockResolvedValueOnce({
      ...unavailableResult,
      selector: { kind: "route", value: "/build" },
      surface: null,
      implementationFiles: [],
      relatedTests: [],
    });

    const result = await executeTool("trace_code_surface", { route: "/build" }, "user-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Code graph unavailable");
    expect(result.message).toBe(unavailableResult.summary);
  });

  it("returns failure when related-test lookup cannot read the graph", async () => {
    mockFindRelatedTests.mockResolvedValueOnce({
      ...unavailableResult,
      filePath: "apps/web/lib/mcp-tools.ts",
      tests: [],
    });

    const result = await executeTool(
      "find_related_tests",
      { filePath: "apps/web/lib/mcp-tools.ts" },
      "user-1",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Code graph unavailable");
    expect(result.message).toBe(unavailableResult.summary);
  });
});
