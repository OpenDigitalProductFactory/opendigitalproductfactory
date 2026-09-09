import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { taskRun: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    taskArtifact: { findUnique: vi.fn() }, taskNode: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    workroom: { findUnique: vi.fn() }, $transaction: vi.fn() },
  reserve: vi.fn(), authority: vi.fn(), dispatch: vi.fn(), evidence: vi.fn(), activity: vi.fn(), publish: vi.fn(), send: vi.fn(),
  resolveFailureEvidence: vi.fn(),
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
vi.mock("@/lib/self-upgrade/quiescence", () => ({ getQuiescenceLevel: vi.fn(async () => "normal") }));
import { getQuiescenceLevel } from "@/lib/self-upgrade/quiescence";
import { executePersistedSemanticReview, enqueueSemanticReview, reconcileSemanticReviews, retryPersistedSemanticReview } from "./semantic-review-background";
vi.mock("./failure-analysis-evidence", () => ({ resolveFailureAnalysisEvidence: mocks.resolveFailureEvidence }));
vi.mock("./failure-readiness-status", () => ({ publishFailureReadinessStatus: vi.fn() }));
import { createSemanticReviewRequest } from "./semantic-review-request";
import { failureAnalysisFixture } from "./failure-analysis.test-fixtures";

const result = { decision: "pass", failureAnalysisReview: { adequate: true, rationale: "Challenged stale evidence and recovery paths against the executed test." }, issues: [], summary: "Exact diff reviewed." };
let row: Record<string, unknown>;
let packet: ReturnType<typeof createSemanticReviewRequest>;
let providerCalls: number;
let transactionCommitted: boolean;
beforeEach(() => {
  vi.clearAllMocks(); providerCalls = 0; transactionCommitted = false;
  vi.mocked(getQuiescenceLevel).mockResolvedValue("normal");
  packet = createSemanticReviewRequest({ surface: "external", authorSurface: "codex", artifactType: "code-change",
    title: "Review", artifact: "diff", changedFiles: ["a.ts"], verificationEvidence: "Tests passed",
    ...failureAnalysisFixture({ capsuleId: "WC-1", headTreeHash: "b".repeat(40), diffDigest: createHash("sha256").update("diff").digest("hex") }),
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
  mocks.resolveFailureEvidence.mockResolvedValue(packet.input.resolvedFailureEvidence);
  mocks.db.taskNode.findUnique.mockResolvedValue(null);
  mocks.db.taskNode.findFirst.mockResolvedValue(null);
  mocks.db.taskNode.create.mockResolvedValue({ id: "node-new" });
  mocks.db.workroom.findUnique.mockResolvedValue({ id: "room-1" });
  mocks.evidence.mockResolvedValue({ id: "evidence-1" });
  mocks.activity.mockResolvedValue({ id: "activity-1" });
  mocks.dispatch.mockImplementation(async (_prompt, _context, branch) => branch("change-reviewer", async () => {
    providerCalls += 1; return result;
  }));
  mocks.send.mockResolvedValue(undefined);
});

describe("durable semantic review worker", () => {
  it("requires the original requester and explicit uncertain-inference confirmation", async () => {
    row.status = "input-required";
    await expect(retryPersistedSemanticReview("TR-1", "other-user", true)).rejects.toThrow("authority");
    await expect(retryPersistedSemanticReview("TR-1", "user-1", false)).rejects.toThrow("confirmation");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("resumes an authorized wait on the same task and persists recovery before enqueue", async () => {
    row.status = "input-required";
    expect(await retryPersistedSemanticReview("TR-1", "user-1", true)).toMatchObject({ newTaskRunId: "TR-1" });
    expect(row.status).toBe("submitted");
    expect(row.progressPayload).toMatchObject({ semanticReview: { recoveryAttempt: 1, generation: null } });
    expect(mocks.activity).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  it("refuses exhausted recovery and revoked authority without emitting work", async () => {
    row.status = "input-required";
    (row.progressPayload as any).semanticReview.recoveryAttempt = 3;
    await expect(retryPersistedSemanticReview("TR-1", "user-1", true)).rejects.toThrow("exhausted");
    (row.progressPayload as any).semanticReview.recoveryAttempt = 0;
    mocks.authority.mockResolvedValue(false);
    await expect(retryPersistedSemanticReview("TR-1", "user-1", true)).rejects.toThrow("authority");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not create two recovery events for concurrent operator requests", async () => {
    row.status = "input-required";
    const outcomes = await Promise.allSettled([
      retryPersistedSemanticReview("TR-1", "user-1", true),
      retryPersistedSemanticReview("TR-1", "user-1", true),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  it("preserves the original deadline when recovery is requested", async () => {
    row.status = "input-required";
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(packet.deadlineAt) + 1);
    try {
      await expect(retryPersistedSemanticReview("TR-1", "user-1", true)).rejects.toThrow("deadline-exhausted");
      expect(mocks.send).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });
  it("refuses recovery while the runtime is quiescing", async () => {
    row.status = "input-required";
    vi.mocked(getQuiescenceLevel).mockResolvedValue("draining");
    await expect(retryPersistedSemanticReview("TR-1", "user-1", true)).rejects.toThrow("quiescing");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("uses a distinct queue identity for authorized recovery", async () => {
    await enqueueSemanticReview("TR-1");
    const original = mocks.send.mock.calls[0]![1];
    row.status = "input-required";
    await retryPersistedSemanticReview("TR-1", "user-1", true);
    expect(mocks.send.mock.calls[1]![1]).not.toBe(original);
    expect(mocks.send.mock.calls[1]![1]).toBe("semantic-review:TR-1:recovery-1:1");
  });
  it("reuses a completed checkpoint from the original attempt after recovery", async () => {
    (row.progressPayload as any).semanticReview.recoveryAttempt = 1;
    mocks.db.taskNode.findUnique.mockImplementation(async ({ where }) =>
      where.taskNodeId.endsWith(":recovery-1") ? null : { status: "completed", outputSnapshot: { requestDigest: packet.digest, result } });
    await executePersistedSemanticReview("TR-1");
    expect(providerCalls).toBe(0);
    expect(row.status).toBe("completed");
  });
  it("retains uncertain attempt evidence when a replacement runs", async () => {
    (row.progressPayload as any).semanticReview.recoveryAttempt = 1;
    mocks.db.taskNode.findUnique.mockImplementation(async ({ where }) =>
      where.taskNodeId.endsWith(":recovery-1") ? null : { taskNodeId: where.taskNodeId, status: "running", outputSnapshot: { diagnostic: "connection lost" } });
    await executePersistedSemanticReview("TR-1");
    expect(providerCalls).toBe(1);
    expect(mocks.db.taskNode.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "superseded", supersededByNodeId: "node-new", outputSnapshot: expect.objectContaining({ diagnostic: "connection lost", providerOutcome: "unknown" }),
    }) }));
    expect(row.status).toBe("completed");
  });
  it.each(["1", -1, 0.5, 4])("refuses malformed recovery counter %s before delivery", async (counter) => {
    (row.progressPayload as any).semanticReview.recoveryAttempt = counter;
    expect(await enqueueSemanticReview("TR-1")).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
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
