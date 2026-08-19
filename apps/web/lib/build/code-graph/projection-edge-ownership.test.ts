import { beforeEach, describe, expect, it, vi } from "vitest";

// The code-graph projection shares graph_node / graph_edge with several other
// projections (doc-impact, EA, infra, portfolio, knowledge). It owns only the rows it
// stamps with `props.graphKey`; everything else belongs to someone else.
//
// This is a regression suite for a measured production incident: a routine re-index
// destroyed ALL 616 doc-impact IMPACTS edges and every one of the 504 DocImpactSource
// markers, leaving 183 DocPage nodes orphaned in the mirror but still counted in the
// explorer census. Nothing failed and nothing logged — the projection simply deleted
// rows it did not own, and the projection that DID own them has no way to notice.
//
// The assertions below are on the emitted SQL rather than on a live database, which is
// what the other suites in this directory do, and is enough to pin the two properties
// that were violated: labels must be UNION-merged, and edge deletes must be scoped to
// owned rows.

const { mockExecuteRawUnsafe } = vi.hoisted(() => ({
  mockExecuteRawUnsafe: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    $executeRawUnsafe: mockExecuteRawUnsafe,
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    codeGraphIndexState: { findUnique: vi.fn(), upsert: vi.fn() },
    codeGraphFileHash: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { clearCodeGraph, syncTrackedFile } from "./neo4j-projection";

/** Every statement the projection issued, whitespace-collapsed for matching. */
function statements(): string[] {
  return mockExecuteRawUnsafe.mock.calls
    .map(([sql]) => (typeof sql === "string" ? sql.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean);
}

function edgeDeletes(): string[] {
  return statements().filter((s) => /^DELETE FROM graph_edge/i.test(s));
}

beforeEach(() => {
  mockExecuteRawUnsafe.mockReset();
  mockExecuteRawUnsafe.mockResolvedValue(undefined);
});

describe("code-graph projection edge ownership", () => {
  it("scopes the detach delete on the per-file failure path", async () => {
    // Distinct code path from clearCodeGraph: when a tracked file fails to parse,
    // syncTrackedFile DETACH-deletes its CodeFile node. That delete targeted the node
    // key directly (`src_key = $1 OR dst_key = $1`) with no edge predicate, so a single
    // unparseable file silently removed every foreign edge pointing at it.
    //
    // An earlier version of this test asserted only that the SQL mentioned "graphKey"
    // anywhere. That PASSED against the unfixed code — the broken statement still
    // contained the string in an unrelated clause — so it proved nothing. Asserting the
    // key-targeting shape carries the predicate is what actually pins the behaviour.
    await syncTrackedFile("repo", process.cwd(), "does-not-exist-here.ts");

    const keyTargeted = edgeDeletes().filter((s) => /src_key = \$1|dst_key = \$1/i.test(s));
    expect(keyTargeted.length).toBeGreaterThan(0);
    for (const sql of keyTargeted) {
      expect(sql).toMatch(/props \? 'graphKey'/);
    }
  });

  it("scopes the incident-edge sweep to owned edges, not merely to owned nodes", async () => {
    await clearCodeGraph("repo");

    // The dangerous shape is `src_key IN (owned nodes) OR dst_key IN (owned nodes)`
    // with no predicate on the EDGE itself: it matches every foreign edge that happens
    // to touch a code node. Wherever the statement reaches for incident edges, it must
    // also carry the ownership test.
    const incident = edgeDeletes().filter((s) => /src_key IN|dst_key IN/i.test(s));
    expect(incident.length).toBeGreaterThan(0);
    for (const sql of incident) {
      expect(sql).toMatch(/props \? 'graphKey'/);
    }
  });
});

describe("code-graph node upsert", () => {
  it("UNION-merges labels instead of replacing them", async () => {
    // `SET labels = excluded.labels` erases additive markers owned by another
    // projection — this is what took all 504 DocImpactSource markers to zero.
    // packages/db/src/graph-sync.ts already union-merges for exactly this reason;
    // this projection held a divergent private copy with the unsafe semantics.
    //
    // Driven through a real sync so the assertion is on emitted SQL, not source text:
    // package.json exists, is not TypeScript, and so exercises the node upsert without
    // dragging in the structural extractor.
    await syncTrackedFile("repo", process.cwd(), "package.json", { skipStructuralClear: true });

    const upserts = statements().filter((s) => /INSERT INTO graph_node/i.test(s));
    expect(upserts.length).toBeGreaterThan(0);

    for (const sql of upserts) {
      expect(sql).not.toMatch(/SET labels = excluded\.labels/);
      expect(sql).toMatch(/labels = graph_node\.labels \|\|/);
    }
  });
});
