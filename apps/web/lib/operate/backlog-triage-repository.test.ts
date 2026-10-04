import { beforeEach, describe, expect, it, vi } from "vitest";
import { triageFingerprint } from "./backlog-triage-assessment";

const db = vi.hoisted(() => ({
  backlogItem: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  backlogItemActivity: { create: vi.fn(), update: vi.fn() },
  scheduledJob: { findUnique: vi.fn() },
  $executeRaw: vi.fn(), $transaction: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
import { applyTriageBuild, beginTriage, finishTriage, selectTriageBatch } from "./backlog-triage-repository";

const now = new Date("2026-10-04T20:00:00Z");
const row = {
  id: "a", itemId: "BI-a", title: "fix", body: "scoped", status: "triaging", type: "bug", workType: "product", effortSize: null, proposedOutcome: null, updatedAt: now,
  triageAssessmentFingerprint: null as string | null, triageAssessmentOutcome: null as string | null,
  triageAssessmentAttempts: 0, triageAssessmentRetryAt: null, triageAssessmentClaim: null as string | null, triageAssessedAt: null as Date | null,
  activities: [] as { recordedAt: Date }[],
};
beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.scheduledJob.findUnique.mockResolvedValue(null);
  db.backlogItemActivity.create.mockResolvedValue({ id: "activity" });
  db.backlogItem.updateMany.mockResolvedValue({ count: 1 });
});
describe("persisted triage queue", () => {
  it("skips an unchanged held prefix using durable fields even after audit pruning", async () => {
    const held = { ...row, triageAssessmentFingerprint: triageFingerprint(row), triageAssessmentOutcome: "needsReview", triageAssessmentAttempts: 1, triageAssessedAt: now };
    db.backlogItem.findMany.mockResolvedValue([held, { ...row, id: "b", itemId: "BI-b" }]);
    const batch = await selectTriageBatch(1, now);
    expect(batch.items.map(i => i.itemId)).toEqual(["BI-b"]);
    expect(batch.held).toBe(1);
  });
  it("wraps a durable cursor and bounds the scan", async () => {
    db.scheduledJob.findUnique.mockResolvedValue({ runCursor: "z" });
    db.backlogItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([row]);
    expect((await selectTriageBatch(25, now)).items).toHaveLength(1);
    expect(db.backlogItem.findMany.mock.calls[0][0]).toMatchObject({ where: { id: { gt: "z" } }, take: 1000 });
    expect(db.backlogItem.findMany.mock.calls[1][0].where).not.toHaveProperty("id");
  });
  it("does not claim a candidate manually changed since selection", async () => {
    db.backlogItem.findUnique.mockResolvedValue({ ...row, status: "open" });
    expect(await beginTriage(row.itemId, triageFingerprint(row), now.toISOString(), now)).toBeNull();
    expect(db.backlogItemActivity.create).not.toHaveBeenCalled();
  });
  it("allows an explicit later return to triaging without redoing unrelated activity", async () => {
    const held = { ...row, triageAssessmentFingerprint: triageFingerprint(row), triageAssessmentOutcome: "needsReview", triageAssessmentAttempts: 1, triageAssessedAt: now };
    db.backlogItem.findMany.mockResolvedValue([held]);
    expect((await selectTriageBatch(25, now)).items).toHaveLength(0);
    db.backlogItem.findMany.mockResolvedValue([{ ...held, activities: [{ recordedAt: new Date(now.getTime() + 1) }] }]);
    expect((await selectTriageBatch(25, now)).items).toHaveLength(1);
  });
  it("fences an expired worker and a manual edit during inference", async () => {
    db.backlogItem.updateMany.mockResolvedValue({ count: 0 });
    expect(await applyTriageBuild(row as never, "old-worker", "small", "reason")).toBe(false);
    expect(db.backlogItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ triageAssessmentClaim: "old-worker" }) }));
    db.backlogItem.updateMany.mockResolvedValue({ count: 0 });
    expect(await applyTriageBuild(row as never, "worker", "small", "reason")).toBe(false);
    expect(db.backlogItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ updatedAt: now, status: "triaging" }) }));
  });
  it("finishes only its own claim, while keeping a bounded audit outcome", async () => {
    await finishTriage("activity", triageFingerprint(row), 1, "needs-review", now, "held", row.id, "worker");
    expect(db.backlogItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: row.id, triageAssessmentClaim: "worker" }, data: expect.objectContaining({ triageAssessmentOutcome: "needsReview" }) }));
    expect(db.backlogItemActivity.update).toHaveBeenCalled();
  });
});
