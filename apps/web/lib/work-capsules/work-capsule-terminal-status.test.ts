import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeTransition } = vi.hoisted(() => ({ completeTransition: vi.fn() }));
vi.mock("@/lib/backlog/initiative-readiness", () => ({
  completeWorkCapsuleTransition: completeTransition,
}));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));

import { createWorkCapsule, updateWorkCapsuleStatus, type CapsuleDb } from "./work-capsule-store";

function fakeDb() {
  const workroom = {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  };
  return {
    workroom,
    workroomActivity: { create: vi.fn() },
    db: { workroom, workroomActivity: { create: vi.fn() } } as unknown as CapsuleDb,
  };
}

describe("governed Work Capsule terminal status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses to create a Work Capsule already marked complete", async () => {
    const fake = fakeDb();
    await expect(createWorkCapsule({
      db: fake.db,
      input: {
        title: "Already done",
        objective: "Skip the completion gate",
        source: "manual",
        idempotencyKey: "manual:already-done",
        status: "complete",
      },
      actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
    })).rejects.toThrow(/non-terminal state/i);
    expect(fake.workroom.create).not.toHaveBeenCalled();
  });

  it("routes governed complete status through the canonical terminal boundary", async () => {
    const fake = fakeDb();
    fake.workroom.findUnique
      .mockResolvedValueOnce({
        id: "row-1", capsuleId: "WC-GOVERNED", status: "working", backlogItemId: "BI-1",
        featureBuildId: null, taskRunId: null,
      })
      .mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-GOVERNED", status: "complete" });
    completeTransition.mockResolvedValueOnce({ ok: true });

    const result = await updateWorkCapsuleStatus({
      db: fake.db,
      capsuleId: "WC-GOVERNED",
      status: "complete",
      reason: "Verified delivery",
      actor: { userId: "user-1", agentId: "agent-1", principalId: "principal-1" },
      now: new Date("2026-08-22T08:00:00.000Z"),
    });

    expect(result.status).toBe("complete");
    expect(completeTransition).toHaveBeenCalledWith(expect.objectContaining({
      capsuleId: "WC-GOVERNED", expectedStatus: "working", reason: "Verified delivery",
    }));
    expect(fake.workroom.update).not.toHaveBeenCalled();
  });
});
