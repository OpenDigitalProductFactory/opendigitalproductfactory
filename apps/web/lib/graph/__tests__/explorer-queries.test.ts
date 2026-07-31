import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQueryRawUnsafe } = vi.hoisted(() => ({ mockQueryRawUnsafe: vi.fn() }));

vi.mock("@dpf/db", () => ({ prisma: { $queryRawUnsafe: mockQueryRawUnsafe } }));

import {
  MAX_EXPAND_DEPTH,
  MAX_SUBGRAPH_NODES,
  clampDepth,
  clampNodeCap,
  clampSearchLimit,
  expandGraphNeighbourhood,
  getGraphCensus,
  normalizeFilterList,
  resolveNodeDetail,
  resolveNodeName,
  searchGraphNodes,
} from "../explorer-queries";

type NodeRow = { key: string; labels: string[]; props: Record<string, unknown> };
type EdgeRow = { src_key: string; dst_key: string; rel_type: string };

function node(key: string, props: Record<string, unknown> = {}, labels = ["CodeFile"]): NodeRow {
  return { key, labels, props };
}

function edge(src: string, dst: string, relType = "IMPORTS"): EdgeRow {
  return { src_key: src, dst_key: dst, rel_type: relType };
}

/** The SQL text of the nth $queryRawUnsafe call. */
function sqlOf(callIndex: number): string {
  return String(mockQueryRawUnsafe.mock.calls[callIndex]?.[0] ?? "");
}

beforeEach(() => {
  mockQueryRawUnsafe.mockReset();
});

describe("clamps", () => {
  it("keeps depth inside 1..MAX_EXPAND_DEPTH and defaults to one hop", () => {
    expect(clampDepth(undefined)).toBe(1);
    expect(clampDepth(0)).toBe(1);
    expect(clampDepth(99)).toBe(MAX_EXPAND_DEPTH);
    expect(clampDepth(2.7)).toBe(2);
  });

  it("never lets a caller raise the node cap above the render ceiling", () => {
    expect(clampNodeCap(10_000)).toBe(MAX_SUBGRAPH_NODES);
    expect(clampNodeCap(undefined)).toBe(MAX_SUBGRAPH_NODES);
    expect(clampNodeCap(25)).toBe(25);
  });

  it("clamps the search limit", () => {
    expect(clampSearchLimit(undefined)).toBe(25);
    expect(clampSearchLimit(5000)).toBe(100);
  });
});

describe("normalizeFilterList", () => {
  it("treats an empty list as no restriction", () => {
    expect(normalizeFilterList([])).toBeUndefined();
    expect(normalizeFilterList(["  ", ""])).toBeUndefined();
  });

  it("trims and de-duplicates", () => {
    expect(normalizeFilterList([" CodeFile ", "CodeFile", "TestFile"])).toEqual([
      "CodeFile",
      "TestFile",
    ]);
  });
});

describe("node naming", () => {
  it("prefers name, then path, then the raw key", () => {
    expect(resolveNodeName("k1", { name: "Widget" })).toBe("Widget");
    expect(resolveNodeName("k1", { path: "apps/web/x.ts" })).toBe("apps/web/x.ts");
    expect(resolveNodeName("k1", {})).toBe("k1");
  });

  it("never repeats the name in the detail line", () => {
    expect(resolveNodeDetail("k1", "apps/web/x.ts", { path: "apps/web/x.ts" })).toBe("k1");
    expect(resolveNodeDetail("k1", "k1", {})).toBeNull();
  });
});

describe("getGraphCensus", () => {
  it("converts BigInt counts and reports both totals", async () => {
    mockQueryRawUnsafe
      .mockResolvedValueOnce([{ label: "CodeSymbol", count: 7268n }])
      .mockResolvedValueOnce([{ rel_type: "IMPORTS", count: 10764n }])
      .mockResolvedValueOnce([{ count: 24602n }])
      .mockResolvedValueOnce([{ count: 31904n }]);

    const census = await getGraphCensus();

    expect(census.labels).toEqual([{ label: "CodeSymbol", count: 7268 }]);
    expect(census.relTypes).toEqual([{ relType: "IMPORTS", count: 10764 }]);
    expect(census.nodeTotal).toBe(24602);
    expect(census.edgeTotal).toBe(31904);
  });
});

describe("searchGraphNodes", () => {
  it("returns nothing for a blank query without touching the database", async () => {
    expect(await searchGraphNodes({ query: "   " })).toEqual([]);
    expect(mockQueryRawUnsafe).not.toHaveBeenCalled();
  });

  it("binds the query as a parameter and escapes LIKE wildcards", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([node("k1", { name: "BacklogItem" })]);

    await searchGraphNodes({ query: "100%_raw" });

    const [, pattern, raw] = mockQueryRawUnsafe.mock.calls[0]!;
    expect(pattern).toBe("%100\\%\\_raw%");
    expect(raw).toBe("100%_raw");
    expect(sqlOf(0)).toContain("$1");
    // The operator's text must never be concatenated into the statement.
    expect(sqlOf(0)).not.toContain("100");
  });

  it("ranks a name match above a key-or-path-only match", async () => {
    // Regression guard: searching "BacklogItem" used to return PrismaField rows
    // named "id"/"body" first, because they matched on key and then won the
    // length tiebreak. Name matches must outrank them.
    mockQueryRawUnsafe.mockResolvedValue([]);

    await searchGraphNodes({ query: "BacklogItem" });

    const sql = sqlOf(0);
    const exactRank = sql.indexOf("= lower($2)");
    const nameRank = sql.indexOf("n.props->>'name', '') ILIKE $1");
    const lengthRank = sql.indexOf("length(coalesce");
    expect(exactRank).toBeGreaterThan(-1);
    expect(nameRank).toBeGreaterThan(exactRank);
    expect(lengthRank).toBeGreaterThan(nameRank);
  });

  it("adds a label filter only when one is supplied", async () => {
    mockQueryRawUnsafe.mockResolvedValue([]);

    await searchGraphNodes({ query: "x" });
    expect(sqlOf(0)).not.toContain("labels &&");

    mockQueryRawUnsafe.mockReset();
    mockQueryRawUnsafe.mockResolvedValue([]);
    await searchGraphNodes({ query: "x", labels: ["CodeFile"] });
    expect(sqlOf(0)).toContain("n.labels && $3::text[]");
  });
});

describe("expandGraphNeighbourhood", () => {
  it("returns an empty subgraph without querying when there are no seeds", async () => {
    const result = await expandGraphNeighbourhood({ seedKeys: ["", "  "] });
    expect(result).toEqual({ nodes: [], edges: [], truncated: false, notice: null });
    expect(mockQueryRawUnsafe).not.toHaveBeenCalled();
  });

  it("walks one hop and returns only edges among the collected nodes", async () => {
    mockQueryRawUnsafe
      // seed nodes
      .mockResolvedValueOnce([node("a", { name: "A" })])
      // edges touching the frontier
      .mockResolvedValueOnce([edge("a", "b"), edge("c", "a")])
      // candidate nodes
      .mockResolvedValueOnce([node("b", { name: "B" }), node("c", { name: "C" })])
      // final edges among the collected set
      .mockResolvedValueOnce([edge("a", "b"), edge("c", "a")]);

    const result = await expandGraphNeighbourhood({ seedKeys: ["a"], depth: 1 });

    expect(result.nodes.map((n) => n.key).sort()).toEqual(["a", "b", "c"]);
    expect(result.edges).toEqual([
      { from: "a", to: "b", relType: "IMPORTS" },
      { from: "c", to: "a", relType: "IMPORTS" },
    ]);
    expect(result.truncated).toBe(false);
    expect(result.notice).toBeNull();
  });

  it("stops at the node cap and explains the clipping", async () => {
    mockQueryRawUnsafe
      .mockResolvedValueOnce([node("a")])
      .mockResolvedValueOnce([edge("a", "b"), edge("a", "c"), edge("a", "d")])
      .mockResolvedValueOnce([node("b"), node("c"), node("d")])
      .mockResolvedValueOnce([]);

    const result = await expandGraphNeighbourhood({ seedKeys: ["a"], depth: 1, nodeCap: 2 });

    expect(result.nodes).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.notice).toContain("clipped");
  });

  it("filters expansion by label but never drops an explicitly requested seed", async () => {
    mockQueryRawUnsafe
      // the seed itself is a PrismaModel even though the filter asks for CodeFile
      .mockResolvedValueOnce([node("a", { name: "A" }, ["PrismaModel"])])
      .mockResolvedValueOnce([edge("a", "b"), edge("a", "t")])
      .mockResolvedValueOnce([node("b", {}, ["CodeFile"]), node("t", {}, ["TestFile"])])
      .mockResolvedValueOnce([edge("a", "b")]);

    const result = await expandGraphNeighbourhood({
      seedKeys: ["a"],
      depth: 1,
      labels: ["CodeFile"],
    });

    expect(result.nodes.map((n) => n.key).sort()).toEqual(["a", "b"]);
  });

  it("constrains traversal to the requested relationship types", async () => {
    mockQueryRawUnsafe
      .mockResolvedValueOnce([node("a")])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expandGraphNeighbourhood({ seedKeys: ["a"], depth: 1, relTypes: ["IMPORTS"] });

    // call 0 = seed nodes, call 1 = edges touching the frontier
    expect(sqlOf(1)).toContain("e.rel_type = ANY($2::text[])");
    expect(mockQueryRawUnsafe.mock.calls[1]?.[2]).toEqual(["IMPORTS"]);
  });

  it("does a second round-trip for a two-hop walk", async () => {
    mockQueryRawUnsafe
      .mockResolvedValueOnce([node("a")])
      .mockResolvedValueOnce([edge("a", "b")])
      .mockResolvedValueOnce([node("b")])
      .mockResolvedValueOnce([edge("b", "c")])
      .mockResolvedValueOnce([node("c")])
      .mockResolvedValueOnce([edge("a", "b"), edge("b", "c")]);

    const result = await expandGraphNeighbourhood({ seedKeys: ["a"], depth: 2 });

    expect(result.nodes.map((n) => n.key).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns nothing when the seed key does not exist", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);

    const result = await expandGraphNeighbourhood({ seedKeys: ["missing"] });

    expect(result.nodes).toEqual([]);
    expect(mockQueryRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
