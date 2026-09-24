// BI-821EEB18 — a person hands their own room to a new assistant: the executor
// changes and the assistant is admitted to that one room, together or not at all.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));

import { reassignCapsuleExecutor } from "./reassign-executor-handler";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

const oauthActor: WorkCapsuleActor = {
  userId: "user-alice", agentId: "AGT-EXT-CLAUDE", principalId: "human-alice", agentPrincipalId: "assistant-new",
} as WorkCapsuleActor;

function fakeDb(participants: Array<{ id: string; principalId: string; roles: string[]; lifecycle: string }> = []) {
  const db = {
    workroom: {
      findUnique: vi.fn(async () => ({ id: "row-1", executorKind: "codex-desktop", executorRef: "old", leaseHolderPrincipalId: "human-alice" })),
      update: vi.fn(async () => ({ id: "row-1", capsuleId: "WC-1" })),
    },
    workroomActivity: { create: vi.fn(async () => ({})) },
    workroomParticipant: {
      findMany: vi.fn(async ({ where }: { where: { principalId: string } }) => participants.filter((row) => row.principalId === where.principalId)),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    // A Prisma interactive transaction client has no $transaction of its own.
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ ...db, $transaction: undefined })),
  };
  return db;
}

const params = { capsuleId: "WC-1", toExecutorKind: "claude-desktop", reason: "Codex session ended." };

describe("reassignCapsuleExecutor", () => {
  let db: ReturnType<typeof fakeDb>;
  beforeEach(() => { db = fakeDb(); });

  it("admits the person's new assistant to that room as a contributor and records it", async () => {
    const result = await reassignCapsuleExecutor({ params, db: db as unknown as CapsuleDb, resolveActor: async () => oauthActor });
    expect(result).toMatchObject({ success: true, data: { assistantAdmitted: true } });
    expect(result.message).toContain("get_workroom");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.workroomParticipant.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      workroomId: "row-1", principalId: "assistant-new", roles: ["contributor"], lifecycle: "active",
    }) });
    expect(db.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      kind: "coworker-joined", payload: expect.objectContaining({ source: "handover", assistantPrincipalId: "assistant-new" }),
    }) });
  });

  it("never re-admits an assistant that was removed, and leaves an existing member's roles alone", async () => {
    db = fakeDb([{ id: "p1", principalId: "assistant-new", roles: ["contributor"], lifecycle: "removed" }]);
    await expect(reassignCapsuleExecutor({ params, db: db as unknown as CapsuleDb, resolveActor: async () => oauthActor }))
      .resolves.toMatchObject({ success: true, data: { assistantAdmitted: false } });
    db = fakeDb([{ id: "p1", principalId: "assistant-new", roles: ["observer"], lifecycle: "active" }]);
    await reassignCapsuleExecutor({ params, db: db as unknown as CapsuleDb, resolveActor: async () => oauthActor });
    expect(db.workroomParticipant.create).not.toHaveBeenCalled();
    expect(db.workroomParticipant.update).not.toHaveBeenCalled();
  });

  it("admits nobody when the caller is not an assistant acting for a person", async () => {
    const operator = { userId: "user-alice", agentId: null, principalId: "human-alice" } as unknown as WorkCapsuleActor;
    await expect(reassignCapsuleExecutor({ params, db: db as unknown as CapsuleDb, resolveActor: async () => operator }))
      .resolves.toMatchObject({ success: true, data: { assistantAdmitted: false } });
    expect(db.workroomParticipant.create).not.toHaveBeenCalled();
  });

  it("rolls the admission back with the executor change when either fails", async () => {
    db.workroomParticipant.create.mockRejectedValue(new Error("write failed"));
    await expect(reassignCapsuleExecutor({ params, db: db as unknown as CapsuleDb, resolveActor: async () => oauthActor }))
      .resolves.toMatchObject({ success: false, error: "reassign_failed" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("validates its input before touching the room", async () => {
    await expect(reassignCapsuleExecutor({ params: { capsuleId: "WC-1", toExecutorKind: "robot" }, db: db as unknown as CapsuleDb, resolveActor: async () => oauthActor }))
      .resolves.toMatchObject({ error: "invalid_executor_kind" });
    expect(db.workroom.update).not.toHaveBeenCalled();
  });
});
