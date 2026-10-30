import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));

import { claimBacklogItemWorkspace, type CapsuleDb } from "./work-capsule-store";

// BI-8DE5429B (WWMD DI-139981F74A44): a room claimed for a backlog item takes
// that item's own outcome as its objective; no separate objective is invented.

function fakeDb(item: Record<string, unknown>) {
  const db = {
    workroom: {
      create: vi.fn(async () => ({ id: "row-1", capsuleId: "WC-CLAIM01", headBranch: "feat/x", worktreePath: "/wt/x" })),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      update: vi.fn(),
    },
    workroomActivity: { create: vi.fn() },
    backlogItem: { findFirst: vi.fn(async () => item), update: vi.fn(async () => ({ id: "bi-row-1" })) },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db;
}

const input = {
  backlogItemId: "BI-7D20BFDF",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  headBranch: "feat/x",
  worktreePath: "/wt/x",
  executorKind: "codex-desktop" as const,
  executorRef: "session-A",
};
const actor = { userId: "user-1", agentId: "agent-1", principalId: "PRN-1" };
const unclaimed = { id: "bi-row-1", itemId: "BI-7D20BFDF", epicId: "EP-1", claimStatus: null, claimedById: null, claimedByAgentId: null, claimedAt: null };

describe("claimBacklogItemWorkspace room objective", () => {
  it("is the item's own outcome", async () => {
    const db = fakeDb({ ...unclaimed, title: "Work location claim", outcome: "Two agents never work the same item at once." });
    await claimBacklogItemWorkspace({ db: db as unknown as CapsuleDb, input, actor });
    expect(db.workroom.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ objective: "Two agents never work the same item at once." }),
    }));
  });

  it("falls back to the title for an item with no outcome yet", async () => {
    const db = fakeDb({ ...unclaimed, title: "Work location claim", outcome: null });
    await claimBacklogItemWorkspace({ db: db as unknown as CapsuleDb, input, actor });
    expect(db.workroom.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ objective: "Work location claim" }),
    }));
  });
});
