// BI-4ED5DB61 (live, 2026-09-24): BI-F73AE8D1 lost its activeBuildId pointer
// (BI-B940FE36) while FB-09FC85CF was still live; the 14:00 tee-up trusted the
// empty pointer and minted FB-7C1EA097, a duplicate that took a WIP slot.
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { promoteBacklogItemToBuildDraft } from "./governed-backlog-tee-up";

describe("promoteBacklogItemToBuildDraft with a live build but no pointer", () => {
  it("never mints a second live build for an item, and re-links the one it has", async () => {
    const tx = {
      backlogItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bi-cuid-dup", itemId: "BI-F73AE8D1", title: "L4 recovery runbook", body: "x",
          status: "open", triageOutcome: "build", effortSize: "medium", activeBuildId: null,
          digitalProductId: null, epicId: null, taxonomyNodeId: null, epic: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      featureBuild: {
        create: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({ id: "build-row-live", buildId: "FB-09FC85CF" }),
      },
    };

    const result = await promoteBacklogItemToBuildDraft({
      tx: tx as never, itemId: "BI-F73AE8D1", userId: "user-1", governedBacklogEnabled: true,
    });

    expect(result.kind).toBe("error");
    expect(tx.featureBuild.create).not.toHaveBeenCalled();
    expect(tx.featureBuild.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ originatingBacklogItemId: "bi-cuid-dup" }),
    }));
    expect(tx.backlogItem.update).toHaveBeenCalledWith({
      where: { id: "bi-cuid-dup" }, data: { activeBuildId: "build-row-live" },
    });
  });
});
