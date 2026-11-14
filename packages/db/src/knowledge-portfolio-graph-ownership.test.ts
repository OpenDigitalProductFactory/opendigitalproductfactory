import { describe, expect, it, vi } from "vitest";

// BI-A63A9476 AC-KLR-8: rebuilding the knowledge graph leaves MENTIONS edges
// untouched. Every DELETE the rebuild issues against graph_edge is scoped to the
// relation types it owns.
vi.mock("./client", () => ({
  prisma: {
    $executeRawUnsafe: vi.fn(async () => 0),
    $queryRawUnsafe: vi.fn(async () => []),
    wikiPage: { findMany: vi.fn(async () => []) },
    wikiPageLink: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), createMany: vi.fn() },
    portfolio: { findMany: vi.fn(async () => []) },
    taxonomyNode: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    digitalProduct: { findMany: vi.fn(async () => []) },
  },
}));

import { prisma } from "./client";
import { rebuildKnowledgeAndPortfolioGraph } from "./knowledge-portfolio-graph-sync";

describe("knowledge and portfolio rebuild edge ownership (AC-KLR-8)", () => {
  it("deletes only LINKS_TO and OVERRIDES edges", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await rebuildKnowledgeAndPortfolioGraph();
    log.mockRestore();
    const edgeDeletes = vi
      .mocked(prisma.$executeRawUnsafe)
      .mock.calls.map((call) => String(call[0]))
      .filter((sql) => sql.includes("DELETE FROM graph_edge"));
    expect(edgeDeletes.length).toBeGreaterThan(0);
    for (const sql of edgeDeletes) {
      expect(sql).toMatch(/rel_type IN \('LINKS_TO', 'OVERRIDES'\)|rel_type = \$2/);
      expect(sql).not.toContain("MENTIONS");
    }
  });
});
