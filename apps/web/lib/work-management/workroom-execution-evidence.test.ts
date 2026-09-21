import { describe, expect, it, vi } from "vitest";
import { loadWorkroomExecutionEvidence } from "./workroom-execution-evidence";

const now = new Date("2026-09-21T00:00:00Z");
const rooms = [{ id: "room-row", capsuleId: "WC-ROOM" }];
const event = (id: string) => ({ id, workCapsuleId: "room-row", kind: "verification",
  summary: "Recorded check", recordedAt: now });

describe("loadWorkroomExecutionEvidence", () => {
  it("does not read unrelated execution when there are no rooms", async () => {
    const findMany = vi.fn();
    const result = await loadWorkroomExecutionEvidence({ workroomActivity: { findMany }, taskRun: { findMany } }, [], now);
    expect(findMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ activities: [], receipts: [], partial: false });
  });

  it("marks truncated history partial and keeps a bounded observed evidence window", async () => {
    const findMany = vi.fn().mockResolvedValue(Array.from({ length: 21 }, (_, i) => event(`event-${i}`)));
    const result = await loadWorkroomExecutionEvidence({ workroomActivity: { findMany },
      taskRun: { findMany: vi.fn().mockResolvedValue([]) } }, rooms, now);
    expect(findMany).toHaveBeenCalledWith({ where: { workCapsuleId: { in: ["room-row"] } },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 21 });
    expect(result.partial).toBe(true);
    expect(result.activities).toHaveLength(20);
    expect(result.receipts).toHaveLength(20);
    expect(result.receipts.every(receipt => receipt.status === "observed")).toBe(true);
    expect(result.receipts[0].sourceRef.id).toBe("WC-ROOM");
  });

  it("preserves journal evidence when the reviewer source fails", async () => {
    const result = await loadWorkroomExecutionEvidence({
      workroomActivity: { findMany: vi.fn().mockResolvedValue([event("event-1")]) },
      taskRun: { findMany: vi.fn().mockRejectedValue(new Error("unavailable")) },
    }, rooms, now);
    expect(result.partial).toBe(true);
    expect(result.receipts).toHaveLength(1);
    expect(result.attentionReason).toContain("could not be read");
  });

  it("distinguishes an unavailable journal from a successfully read empty history", async () => {
    const taskRun = { findMany: vi.fn().mockResolvedValue([]) };
    expect((await loadWorkroomExecutionEvidence({ taskRun }, rooms, now)).partial).toBe(true);
    expect((await loadWorkroomExecutionEvidence({ taskRun,
      workroomActivity: { findMany: vi.fn().mockResolvedValue([]) } }, rooms, now)).partial).toBe(false);
  });
});
