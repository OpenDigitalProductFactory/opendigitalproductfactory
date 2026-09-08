import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { taskRun: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    taskArtifact: { findUnique: vi.fn() }, taskNode: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    workroom: { findUnique: vi.fn() }, $transaction: vi.fn() },
  reserve: vi.fn(), authority: vi.fn(), dispatch: vi.fn(), evidence: vi.fn(), activity: vi.fn(), publish: vi.fn(), send: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: mocks.db }));
vi.mock("@/lib/observability/heartbeat", () => ({ reserveSubmittedTaskRunWorking: mocks.reserve,
  withHeartbeatTicker: (_id: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/observability/external-evidence-store", () => ({ recordExternalEvidenceInStore: mocks.evidence }));
vi.mock("@/lib/queue/mcp-task-run-events", () => ({ sendMcpTaskRunExecutionEvent: mocks.send }));
vi.mock("@/lib/work-capsules/work-capsule-store", () => ({ recordWorkCapsuleEvidence: mocks.activity }));
vi.mock("@/lib/work-capsules/activity-events", () => ({ publishRecordedWorkCapsuleActivity: mocks.publish }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("./semantic-review-authority", () => ({ verifySemanticReviewAuthority: mocks.authority }));
vi.mock("./routed-semantic-review", () => ({ dispatchRoutedSemanticReview: mocks.dispatch }));
import { createSemanticReviewRequest } from "./semantic-review-request";
import { executePersistedSemanticReview, enqueueSemanticReview, reconcileSemanticReviews } from "./semantic-review-background";

const result = { decision: "pass", issues: [], summary: "Exact diff reviewed." };
let row: Record<string, unknown>;
let packet: ReturnType<typeof createSemanticReviewRequest>;
let providerCalls: number;
let transactionCommitted: boolean;
beforeEach(() => {
  vi.clearAllMocks(); providerCalls = 0; transactionCommitted = false;
  packet = createSemanticReviewRequest({ surface: "external", authorSurface: "codex", artifactType: "code-change",
    title: "Review", artifact: "diff", changedFiles: ["a.ts"], verificationEvidence: "Tests passed",
    identity: { capsuleId: "WC-1", baseTreeHash: "a".repeat(40), headTreeHash: "b".repeat(40),
      diffDigest: createHash("sha256").update("diff").digest("hex"), specialistIds: [] },
  }, { userId: "user-1", agentId: null, apiTokenId: "token-1", authSource: "pat" });
  row = { id: "run-row-1", taskRunId: "TR-1", userId: "user-1", status: "submitted", updatedAt: new Date(),
    a2aMetadata: { gateKind: "semantic-review", gateKey: packet.gateKey, capsuleId: "WC-1" },
    progressPayload: { semanticReview: { schemaVersion: 1, requestDigest: packet.digest, deadlineAt: packet.deadlineAt, dispatchAttempt: 0 } } };
  mocks.db.taskRun.findUnique.mockImplementation(async () => ({ ...row }));
  mocks.db.taskRun.findMany.mockResolvedValue([]);
  mocks.db.taskArtifact.findUnique.mockResolvedValue({ taskRunId: "run-row-1", parts: [{ kind: "data", data: packet }] });
  mocks.db.taskRun.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.status && row.status !== (typeof where.status === "string" ? where.status : where.status.equals)) return { count: 0 };
    if (where.updatedAt && row.updatedAt !== where.updatedAt) return { count: 0 };
    const current = row.progressPayload as { semanticReview: { generation?: string } };
    if (where.progressPayload && current.semanticReview.generation !== where.progressPayload.equals) return { count: 0 };
    Object.assign(row, data, { updatedAt: new Date() }); return { count: 1 };
  });
  mocks.db.taskRun.update.mockImplementation(async ({ data }) => { Object.assign(row, data); return row; });
  mocks.reserve.mockImplementation(async ({ progressPayload }) => {
    if (row.status !== "submitted") return false;
    Object.assign(row, { status: "working", progressPayload }); return true;
  });
  mocks.db.$transaction.mockImplementation(async (fn) => {
    transactionCommitted = false;
    const value = await fn(mocks.db); transactionCommitted = true; return value;
  });
  mocks.publish.mockImplementation(() => { expect(transactionCommitted).toBe(true); });
  mocks.authority.mockResolvedValue(true);
  mocks.db.taskNode.findUnique.mockResolvedValue(null);
  mocks.db.taskNode.findFirst.mockResolvedValue(null);
  mocks.db.workroom.findUnique.mockResolvedValue({ id: "room-1" });
  mocks.evidence.mockResolvedValue({ id: "evidence-1" });
  mocks.activity.mockResolvedValue({ id: "activity-1" });
  mocks.dispatch.mockImplementation(async (_prompt, _context, branch) => branch("change-reviewer", async () => {
    providerCalls += 1; return result;
  }));
  mocks.send.mockResolvedValue(undefined);
});

describe("durable semantic review worker", () => {
  it("reserves one executor for duplicate delivery and writes one canonical receipt", async () => {
    await Promise.all([executePersistedSemanticReview("TR-1"), executePersistedSemanticReview("TR-1")]);
    expect(providerCalls).toBe(1);
    expect(mocks.evidence).toHaveBeenCalledOnce();
    expect(row.status).toBe("completed");
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ db: mocks.db, deferPublication: true }));
    expect(mocks.evidence.mock.calls[0]![1]).toBe(mocks.db);
    expect(mocks.publish).toHaveBeenCalledWith("room-1", "activity-1");
    expect(transactionCommitted).toBe(true);
  });
  it("restarts from a completed branch without another provider call", async () => {
    mocks.db.taskNode.findUnique.mockResolvedValue({ status: "completed", outputSnapshot: { requestDigest: packet.digest, result } });
    await executePersistedSemanticReview("TR-1");
    expect(providerCalls).toBe(0);
    expect(row.status).toBe("completed");
    expect(mocks.evidence).toHaveBeenCalledOnce();
  });
  it("does not publish a receipt when cancellation wins during provider execution", async () => {
    mocks.dispatch.mockImplementation(async () => { row.status = "canceled"; return result; });
    await executePersistedSemanticReview("TR-1");
    expect(row.status).toBe("canceled");
    expect(mocks.evidence).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("leaves an uncertain in-flight branch for reconciliation without replaying it", async () => {
    mocks.db.taskNode.findUnique.mockResolvedValue({ status: "running", outputSnapshot: null });
    // The real dispatcher classifies branch rejections as inconclusive; the
    // worker fence must still prevent that aggregate from overwriting the wait.
    mocks.dispatch.mockImplementation(async (_prompt, _context, branch) => {
      try { return await branch("change-reviewer", async () => { providerCalls += 1; return result; }); }
      catch { return { decision: "inconclusive", issues: [], summary: "Unknown provider outcome." }; }
    });
    await executePersistedSemanticReview("TR-1");
    expect(row.status).toBe("input-required");
    expect(providerCalls).toBe(0);
    expect(mocks.evidence).not.toHaveBeenCalled();
  });
  it("refuses a missing immutable request and revoked authority before dispatch", async () => {
    mocks.db.taskArtifact.findUnique.mockResolvedValue(null);
    await executePersistedSemanticReview("TR-1");
    expect(row.status).toBe("input-required");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("refuses revoked authority before provider dispatch", async () => {
    mocks.authority.mockResolvedValue(false);
    await executePersistedSemanticReview("TR-1");
    expect(row.status).toBe("auth-required");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("reports cancellation when it wins against an admission failure", async () => {
    mocks.db.taskArtifact.findUnique.mockImplementation(async () => { row.status = "canceled"; return null; });
    expect(await executePersistedSemanticReview("TR-1")).toMatchObject({ status: "canceled" });
    expect(row.status).toBe("canceled");
  });
  it("does not dispatch with a corrupt retry counter", async () => {
    (row.progressPayload as any).semanticReview.dispatchAttempt = "unknown";
    expect(await enqueueSemanticReview("TR-1")).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(row.status).toBe("input-required");
  });
  it("exhausts delivery attempts without emitting a fourth event", async () => {
    (row.progressPayload as any).semanticReview.dispatchAttempt = 3;
    expect(await enqueueSemanticReview("TR-1")).toBe(false);
    expect(row.status).toBe("failed");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("retains the outbox after failed event delivery", async () => {
    mocks.send.mockRejectedValue(new Error("queue unavailable"));
    expect(await enqueueSemanticReview("TR-1")).toBe(false);
    expect(row.status).toBe("submitted");
    expect(row.progressPayload).toMatchObject({ semanticReview: { state: "enqueued", dispatchAttempt: 1 } });
  });
  it("exhausts the absolute deadline even while a provider still emits heartbeats", async () => {
    const now = new Date(Date.now() + 31 * 60_000);
    row.status = "working"; row.lastHeartbeatAt = now;
    mocks.db.taskRun.findMany.mockResolvedValue([{ ...row }]);
    await reconcileSemanticReviews(now);
    expect(row.status).toBe("input-required");
    expect(row.progressPayload).toMatchObject({ semanticReview: { reason: "review-deadline-exhausted" } });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
