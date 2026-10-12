import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("@/lib/work-capsules/activity-events", () => ({ publishRecordedWorkCapsuleActivity: vi.fn() }));
import { publishRecordedWorkCapsuleActivity } from "./activity-events";
import { recordWorkCapsuleActivity, recordWorkCapsuleEvidence } from "./work-capsule-activity-store";

describe("transactional Workroom activity", () => {
  it("locks the parent before reading source and publishes only after its transaction commits", async () => {
    const order: string[] = [];
    const tx = { $queryRaw: vi.fn(async () => { order.push("lock"); }),
      workroom: { findUnique: vi.fn(async () => { order.push("source"); return { id: "room-1" }; }) },
      workroomActivity: { create: vi.fn(async () => { order.push("write"); return { id: "activity-1", workCapsuleId: "room-1" }; }) } };
    const db = { ...tx, $transaction: async (write: (tx: unknown) => Promise<unknown>) => {
      const result = await write(tx);
      expect(publishRecordedWorkCapsuleActivity).not.toHaveBeenCalled();
      order.push("commit"); return result;
    } };
    vi.mocked(publishRecordedWorkCapsuleActivity).mockClear();
    await recordWorkCapsuleEvidence({ db: db as never, capsuleId: "WC-ONE",
      evidence: { kind: "pr-gate", stageKey: "implement", outcome: "completed", summary: "Observed only" },
      actor: { userId: "user-1", agentId: null, principalId: null } });
    expect(order).toEqual(["lock", "source", "write", "commit"]);
    expect(publishRecordedWorkCapsuleActivity).toHaveBeenCalledWith("room-1", "activity-1");
    vi.mocked(publishRecordedWorkCapsuleActivity).mockClear();
  });
  it("stamps stage evidence from the server room rather than caller supplied context", async () => {
    const create = vi.fn().mockResolvedValue({ id: "activity-2" });
    await recordWorkCapsuleEvidence({
      db: { workroom: { findUnique: vi.fn().mockResolvedValue({ id: "room-1", capsuleId: "WC-ONE",
        repositoryFullName: "org/repo", headSha: "a".repeat(40),
        scopeClaims: [{ workShape: "delivery-medium@1.0.0" }] }) }, workroomActivity: { create } } as never,
      capsuleId: "WC-ONE", actor: { userId: "user-1", agentId: null, principalId: null },
      evidence: { kind: "pr-gate", stageKey: "implement", outcome: "completed", summary: "Recorded gate",
        sourceBinding: { headSha: "forged" } } as never,
      deferPublication: true,
    });
    expect(create.mock.calls[0][0].data.payload.sourceBinding).toEqual({ version: 1,
      capsuleId: "WC-ONE", repositoryFullName: "org/repo", headSha: "a".repeat(40),
      definitionRef: "delivery-medium@1.0.0", stageKey: "implement", evidenceKind: "pr-gate" });
  });
  it("persists without announcing a transaction that has not committed", async () => {
    const create = vi.fn().mockResolvedValue({ id: "activity-1" });
    const activity = await recordWorkCapsuleActivity({ workroomActivity: { create } } as never, {
      workCapsuleId: "room-1", kind: "evidence-recorded", summary: "Receipt recorded",
      actor: { userId: "user-1", agentId: null, principalId: null },
    }, { deferPublication: true });
    expect(activity.id).toBe("activity-1");
    expect(publishRecordedWorkCapsuleActivity).not.toHaveBeenCalled();
  });
});
