import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-A63A9476 (spec 2026-10-14 §3.3 "Edge ownership"): a whole-label wipe used
// by a rebuild job must not destroy the MENTIONS edges the reference writer
// owns, nor the nodes those edges still hang off.
vi.mock("./client", () => ({
  prisma: { $executeRawUnsafe: vi.fn().mockResolvedValue(0), $queryRawUnsafe: vi.fn().mockResolvedValue([]) },
}));

import { prisma } from "./client";
import { clearGraphByLabel, REFERENCE_OWNED_REL_TYPES } from "./pg-graph";

const exec = vi.mocked(prisma.$executeRawUnsafe);

describe("clearGraphByLabel edge ownership (AC-KLR-8)", () => {
  beforeEach(() => exec.mockClear());

  it("keeps MENTIONS edges when wiping a label", async () => {
    await clearGraphByLabel("Document");
    const [edgeDelete, nodeDelete] = exec.mock.calls;
    expect(edgeDelete?.[0]).toContain("DELETE FROM graph_edge");
    expect(edgeDelete?.[0]).toContain("rel_type <> ALL($2::text[])");
    expect(edgeDelete?.slice(1)).toEqual(["Document", ["MENTIONS"]]);
    expect(REFERENCE_OWNED_REL_TYPES).toEqual(["MENTIONS"]);

    expect(nodeDelete?.[0]).toContain("DELETE FROM graph_node");
    expect(nodeDelete?.[0]).toContain("NOT EXISTS");
  });
});
