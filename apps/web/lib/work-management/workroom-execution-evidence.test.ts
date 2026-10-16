import { describe, expect, it, vi } from "vitest";
import { loadWorkroomExecutionEvidence } from "./workroom-execution-evidence";
vi.mock("@dpf/db", () => ({ prisma: {}, Prisma: {
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  join: (values: unknown[]) => values,
} }));

const now = new Date("2026-09-21T00:00:00Z");
const rooms = [{ id: "room-row", capsuleId: "WC-ROOM" }];
const event = (id: string) => ({ id, workCapsuleId: "room-row", kind: "verification",
  summary: "Recorded check", recordedAt: now });

describe("loadWorkroomExecutionEvidence", () => {
  it("retains current-source requirement evidence beyond the recent activity window", async () => {
    const room = { ...rooms[0], repositoryFullName: "org/repo", headSha: "a".repeat(40),
      scopeClaims: [{ workShape: "delivery-medium@1.0.0" }] };
    const receipt = { ...event("older-required-receipt"), kind: "evidence-recorded", payload: {
      kind: "pr-gate", stageKey: "implement", outcome: "completed",
      sourceBinding: { version: 1, capsuleId: room.capsuleId, repositoryFullName: room.repositoryFullName,
        headSha: room.headSha, definitionRef: "delivery-medium@1.0.0", stageKey: "implement", evidenceKind: "pr-gate" },
    } };
    const recent = Array.from({ length: 21 }, (_, i) => ({ ...event(`newer-${i}`), kind: "note" }));
    const db = { workroomActivity: { findMany: vi.fn().mockResolvedValue(recent) },
      $queryRaw: vi.fn().mockResolvedValue([receipt]), taskRun: { findMany: vi.fn().mockResolvedValue([]) } };
    const result = await loadWorkroomExecutionEvidence(db, [room], now);
    expect(result.activities).toHaveLength(20);
    expect(result.partial).toBe(true);
    expect(result.receipts).toEqual([expect.objectContaining({ status: "observed", rawRef: {
      table: "WorkroomActivity", id: receipt.id }, processEvidence: {
      definitionRef: "delivery-medium@1.0.0", stageKey: "implement", evidenceKind: "pr-gate", relationship: "required-evidence",
    } })]);
    expect(db.$queryRaw).toHaveBeenCalledOnce();
    // The same immutable receipt in both lanes is shown once.
    db.workroomActivity.findMany.mockResolvedValue([receipt]);
    expect((await loadWorkroomExecutionEvidence(db, [room], now)).receipts).toHaveLength(1);
    // The adapter still rejects stale source and foreign-room bindings.
    expect((await loadWorkroomExecutionEvidence(db, [{ ...room, headSha: "b".repeat(40) }], now))
      .receipts.every(receipt => !receipt.processEvidence)).toBe(true);
    expect((await loadWorkroomExecutionEvidence(db, [{ ...room, id: "other-row", capsuleId: "WC-OTHER" }], now))
      .receipts.every(receipt => !receipt.processEvidence)).toBe(true);
    db.$queryRaw.mockRejectedValue(new Error("source unavailable"));
    const unavailable = await loadWorkroomExecutionEvidence(db, [room], now);
    expect(unavailable.partial).toBe(true);
    expect(unavailable.receipts).toHaveLength(1);
  });

  it("binds a journal record to its current versioned requirement without granting a verdict", async () => {
    const room = { ...rooms[0], repositoryFullName: "org/repo", headSha: "a".repeat(40),
      scopeClaims: [{ workShape: "delivery-medium@1.0.0" }] };
    const row = { ...event("bound-1"), kind: "evidence-recorded", payload: {
      kind: "pr-gate", stageKey: "implement", outcome: "completed",
      sourceBinding: { version: 1, capsuleId: "WC-ROOM", repositoryFullName: "org/repo",
        headSha: room.headSha, definitionRef: "delivery-medium@1.0.0", stageKey: "implement", evidenceKind: "pr-gate" },
    } };
    const db = { workroomActivity: { findMany: vi.fn().mockResolvedValue([row]) },
      taskRun: { findMany: vi.fn().mockResolvedValue([]) } };
    const result = await loadWorkroomExecutionEvidence(db, [room], now);
    expect(result.receipts[0]).toMatchObject({ status: "observed", processEvidence: {
      definitionRef: "delivery-medium@1.0.0", stageKey: "implement", evidenceKind: "pr-gate", relationship: "required-evidence",
    } });
    const stale = await loadWorkroomExecutionEvidence(db, [{ ...room, headSha: "b".repeat(40) }], now);
    expect(stale.receipts[0].processEvidence).toBeUndefined();
    expect(stale.receipts[0].status).toBe("observed");
  });
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
