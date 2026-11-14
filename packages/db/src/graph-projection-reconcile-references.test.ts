import { describe, expect, it, vi } from "vitest";

// BI-A63A9476 AC-KLR-8: the projection reconcile reports a `references` count.
// The mirror count is every MENTIONS edge; the source count is the edges whose
// both ends still exist, so an edge left behind by a delete shows as drift.
vi.mock("./client", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      if (sql.includes("rel_type = 'MENTIONS'")) return [{ total: 7n, live: 5n }];
      return [{ n: 0n }];
    }),
    wikiPage: { count: vi.fn(async () => 0) },
    portfolio: { count: vi.fn(async () => 0) },
    taxonomyNode: { count: vi.fn(async () => 0) },
    digitalProduct: { count: vi.fn(async () => 0) },
  },
}));

import { prisma } from "./client";
import { reconcileGraphProjections } from "./graph-projection-reconcile";

describe("reconcileGraphProjections — references (AC-KLR-8)", () => {
  it("adds a references row comparing MENTIONS edges with edges whose ends are live", async () => {
    const rows = await reconcileGraphProjections();
    const references = rows.find((r) => r.projectionKey === "references");
    expect(references).toEqual({
      projectionKey: "references",
      describes: "MENTIONS edges vs edges whose source and target still exist",
      mirrorCount: 7,
      sourceCount: 5,
      drift: 2,
      status: "drifted",
    });
    const sql = vi.mocked(prisma.$queryRawUnsafe).mock.calls.map((c) => String(c[0])).find((s) => s.includes("MENTIONS"))!;
    for (const table of ['"BacklogItem"', '"Epic"', '"Document"', '"WikiPage"', '"WorkItemMessage"', '"WorkCapsule"']) {
      expect(sql).toContain(table);
    }
  });
});
