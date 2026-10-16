import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { taskRun: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    runtimeVerification: { findUnique: vi.fn() }, taskArtifact: { findUnique: vi.fn() }, taskNode: { findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
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
import { executePersistedSemanticReview, enqueueSemanticReview, reconcileSemanticReviews } from "./semantic-review-background";
vi.mock("./failure-analysis-evidence", () => ({ resolveFailureAnalysisEvidence: mocks.resolveFailureEvidence }));
vi.mock("./failure-readiness-status", () => ({ publishFailureReadinessStatus: vi.fn() }));
import { createSemanticReviewRequest } from "./semantic-review-request";
import { failureAnalysisFixture } from "./failure-analysis.test-fixtures";
vi.mock("@/lib/routing/local-provider-capacity", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/routing/local-provider-capacity")>(),
  inspectLocalProviderCapacity: vi.fn(async () => ({ available: true, reason: null })),
}));
import { LocalProviderCapacityDeferredError, inspectLocalProviderCapacity } from "@/lib/routing/local-provider-capacity";
vi.mock("@/lib/inference/host-gpu-admission", () => ({
  inspectLocalGpuAdmission: vi.fn(async () => ({ defer: null, unloadIdle: false })),
}));
import { inspectLocalGpuAdmission } from "@/lib/inference/host-gpu-admission";

const result = { decision: "pass", failureAnalysisReview: { adequate: true, rationale: "Challenged stale evidence and recovery paths against the executed test." }, issues: [], summary: "Exact diff reviewed." };
let row: Record<string, unknown>;
let packet: ReturnType<typeof createSemanticReviewRequest>;
let providerCalls: number;
let transactionCommitted: boolean;
beforeEach(() => {
  vi.clearAllMocks(); providerCalls = 0; transactionCommitted = false;
  vi.mocked(getQuiescenceLevel).mockResolvedValue("normal");
  vi.mocked(inspectLocalProviderCapacity).mockResolvedValue({ available: true, reason: null });
  vi.mocked(inspectLocalGpuAdmission).mockResolvedValue({ defer: null, unloadIdle: false });
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
  mocks.db.taskRun.create.mockImplementation(async ({ data }) => ({ ...data, createdAt: new Date() }));
  mocks.db.runtimeVerification.findUnique.mockResolvedValue(null);
  mocks.db.taskNode.findMany.mockResolvedValue([]);
  mocks.db.taskNode.updateMany.mockResolvedValue({ count: 1 });
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
  mocks.db.taskNode.update.mockReset().mockResolvedValue({});
  mocks.db.workroom.findUnique.mockResolvedValue({ id: "room-1" });
  mocks.evidence.mockResolvedValue({ id: "evidence-1" });
  mocks.activity.mockResolvedValue({ id: "activity-1" });
  mocks.dispatch.mockImplementation(async (_prompt, _context, branch) => branch("change-reviewer", async () => {
    providerCalls += 1; return result;
  }));
  mocks.send.mockResolvedValue(undefined);
});

async function persistedCapacityWait(sibling = false) {
    packet = createSemanticReviewRequest({ ...packet.input, identity: {
      ...packet.input.identity, sourceHeadSha: "c".repeat(40), specialistIds: sibling ? ["AGT-903"] : [],
    } }, packet.actor);
    mocks.db.taskArtifact.findUnique.mockResolvedValue({ taskRunId: "run-row-1", parts: [{ kind: "data", data: packet }] });
    row.a2aMetadata = { gateKind: "semantic-review", gateKey: packet.gateKey, capsuleId: "WC-1" };
    row.progressPayload = { semanticReview: { schemaVersion: 1, requestDigest: packet.digest,
      deadlineAt: packet.deadlineAt, dispatchAttempt: 0 } };
    const nodes = new Map<string, Record<string, unknown>>();
    mocks.db.taskNode.create.mockImplementation(async ({ data }) => {
      const node = { ...data, id: data.taskNodeId };
      nodes.set(data.taskNodeId, node); return node;
    });
    mocks.db.taskNode.update.mockImplementation(async ({ where, data }) => {
      const node = nodes.get(where.taskNodeId);
      if (!node) throw new Error("fixture checkpoint missing");
      Object.assign(node, data); return node;
    });
    mocks.db.taskNode.findUnique.mockImplementation(async ({ where }) => nodes.get(where.taskNodeId) ?? null);
    mocks.db.taskNode.findMany.mockImplementation(async () => [...nodes.values()]);
    mocks.db.taskRun.findMany.mockImplementation(async ({ where }) =>
      where.status.in.includes(row.status) ? [{ ...row }] : []);
    mocks.db.workroom.findUnique.mockResolvedValue({ id: "room-1", capsuleId: "WC-1",
      repositoryFullName: packet.repository, headSha: "c".repeat(40) });
    mocks.dispatch.mockImplementation(async (_prompt, _context, branch) => {
      if (sibling) await branch("AGT-903", async () => { providerCalls += 1; return result; });
      return branch("change-reviewer", async () => { throw new LocalProviderCapacityDeferredError("local-runner-busy"); });
    });
    await enqueueSemanticReview("TR-1");
    await executePersistedSemanticReview("TR-1");
    expect(row.status).toBe("input-required");
    expect(row.progressPayload).toMatchObject({ semanticReview: { capacityRecovery: {
      schemaVersion: 1, requestDigest: packet.digest,
    } } });
    mocks.send.mockClear();
    mocks.dispatch.mockImplementation(async (_prompt, _context, branch) => {
      if (sibling) await branch("AGT-903", async () => { providerCalls += 1; return result; });
      return branch("change-reviewer", async () => { providerCalls += 1; return result; });
    });
    return nodes;
}

describe("automatic semantic-review capacity recovery", () => {
  it("resumes a persisted typed capacity wait without a client and keeps its original budget", async () => {
    await persistedCapacityWait();
    await reconcileSemanticReviews(new Date(Date.now() + 4 * 60_000));
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(row.status).toBe("submitted");
    expect(row.progressPayload).toMatchObject({ semanticReview: {
      deadlineAt: packet.deadlineAt, dispatchAttempt: 2, recoveryAttempt: 1,
    } });
    await executePersistedSemanticReview("TR-1");
    expect(providerCalls).toBe(1);
    expect(row.status).toBe("completed");
    expect(mocks.evidence).toHaveBeenCalledTimes(2);
    expect(row.progressPayload).toMatchObject({ resultClass: "pass", semanticReview: {
      deadlineAt: packet.deadlineAt, recoveryAttempt: 1, evidenceRecordId: "evidence-1",
    } });
  });

  it("reuses a completed passing sibling and admits one generation under concurrent reconciliation", async () => {
    const nodes = await persistedCapacityWait(true);
    expect(providerCalls).toBe(1);
    const now = new Date(Date.now() + 4 * 60_000);
    await Promise.all([reconcileSemanticReviews(now), reconcileSemanticReviews(now)]);
    expect(mocks.send).toHaveBeenCalledOnce();
    await executePersistedSemanticReview("TR-1");
    expect(row.status).toBe("completed");
    expect(providerCalls).toBe(2);
    expect(nodes.get("semantic-review:TR-1:AGT-903")?.status).toBe("completed");
    expect(nodes.has("semantic-review:TR-1:AGT-903:recovery-1")).toBe(false);
  });

  it.each(["CI", "GPU"])("persists %s capacity backoff without consuming attempts or dispatching work", async source => {
    await persistedCapacityWait();
    if (source === "CI") vi.mocked(inspectLocalProviderCapacity).mockResolvedValue({ available: false, reason: "local-ci-active-capacity-reservation" });
    else vi.mocked(inspectLocalGpuAdmission).mockResolvedValue({ defer: "local-runner-busy", unloadIdle: false });
    const now = new Date(Date.now() + 4 * 60_000);
    await reconcileSemanticReviews(now);
    expect(row.progressPayload).toMatchObject({ semanticReview: { deadlineAt: packet.deadlineAt,
      dispatchAttempt: 1, capacityRecovery: { checks: 1 }, capacityWaitReason: source === "CI" ? "local-ci-active-capacity-reservation" : "local-runner-busy" } });
    await reconcileSemanticReviews(new Date(now.getTime() + 1000));
    expect(inspectLocalProviderCapacity).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(providerCalls).toBe(0);
  });

  it.each(["capacity observation", "authority observation"])("persists unavailable %s without calling it a revocation or a pass", async failure => {
    await persistedCapacityWait();
    if (failure === "capacity observation") vi.mocked(inspectLocalGpuAdmission).mockRejectedValue(new Error("private telemetry payload"));
    else mocks.authority.mockRejectedValue(new Error("private authority payload"));
    await reconcileSemanticReviews(new Date(Date.now() + 4 * 60_000));
    expect(row.status).toBe("input-required");
    expect(row.progressPayload).toMatchObject({ semanticReview: { capacityRecovery: { checks: 1 },
      capacityWaitReason: failure === "capacity observation" ? "review-capacity-observation-unavailable" : "review-authority-unavailable" } });
    expect(JSON.stringify(row)).not.toContain("private");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(providerCalls).toBe(0);
  });

  it("rechecks the original deadline after capacity observation before admission", async () => {
    await persistedCapacityWait();
    const now = new Date(Date.now() + 4 * 60_000);
    const clock = vi.spyOn(Date, "now");
    try {
      vi.mocked(inspectLocalGpuAdmission).mockImplementation(async () => {
        clock.mockReturnValue(Date.parse(packet.deadlineAt) + 1);
        return { defer: null, unloadIdle: false };
      });
      await reconcileSemanticReviews(now);
      expect(mocks.send).not.toHaveBeenCalled();
      expect(providerCalls).toBe(0);
    } finally { clock.mockRestore(); }
  });

  it.each(["unknown-node", "missing-proof", "actual-fail", "source", "authority", "evidence", "quiescence", "expired", "attempts", "counter", "request", "cancellation"])(
    "does not automatically dispatch after %s changes", async failure => {
      const nodes = await persistedCapacityWait();
      const progress = (row.progressPayload as { semanticReview: Record<string, unknown> }).semanticReview;
      const node = nodes.get("semantic-review:TR-1:change-reviewer")!;
      const output = node.outputSnapshot as Record<string, unknown>;
      if (failure === "unknown-node") node.status = "running";
      if (failure === "missing-proof") delete output.capacityDeferral;
      if (failure === "actual-fail") output.result = { ...result, decision: "fail" };
      if (failure === "source") mocks.db.workroom.findUnique.mockResolvedValue({ id: "room-1", repositoryFullName: packet.repository, headSha: "d".repeat(40) });
      if (failure === "authority") mocks.authority.mockResolvedValue(false);
      if (failure === "evidence") mocks.resolveFailureEvidence.mockResolvedValue([]);
      if (failure === "quiescence") vi.mocked(getQuiescenceLevel).mockResolvedValue("draining");
      if (failure === "attempts") progress.dispatchAttempt = 3;
      if (failure === "counter") progress.recoveryAttempt = "unknown";
      if (failure === "request") mocks.db.taskArtifact.findUnique.mockResolvedValue(null);
      if (failure === "cancellation") vi.mocked(inspectLocalProviderCapacity).mockImplementation(async () => {
        row.status = "canceled"; return { available: true, reason: null };
      });
      await reconcileSemanticReviews(new Date(Date.now() + (failure === "expired" ? 31 : 4) * 60_000));
      expect(mocks.send).not.toHaveBeenCalled();
      expect(providerCalls).toBe(0);
      expect(row.status).not.toBe("completed");
      expect(mocks.evidence).toHaveBeenCalledOnce(); // Original honest inconclusive receipt only.
      if (failure === "cancellation") expect(row.status).toBe("canceled");
    },
  );

  it("rechecks source after admission before calling a provider", async () => {
    await persistedCapacityWait();
    await reconcileSemanticReviews(new Date(Date.now() + 4 * 60_000));
    expect(mocks.send).toHaveBeenCalledOnce();
    mocks.db.workroom.findUnique.mockResolvedValue({ id: "room-1", repositoryFullName: packet.repository, headSha: "d".repeat(40) });
    await executePersistedSemanticReview("TR-1");
    expect(row.status).toBe("failed");
    expect(providerCalls).toBe(0);
    expect(mocks.evidence).toHaveBeenCalledOnce();
  });

  it("recovers proven branch checkpoints after executor loss without resetting attempts", async () => {
    await persistedCapacityWait();
    row.status = "working";
    row.lastHeartbeatAt = new Date(Date.now() - 4 * 60_000);
    const progress = (row.progressPayload as { semanticReview: Record<string, unknown> }).semanticReview;
    delete progress.capacityRecovery;
    const now = new Date(Date.now() + 4 * 60_000);
    await reconcileSemanticReviews(now);
    expect(row.status).toBe("input-required");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(progress.dispatchAttempt).toBe(1);
    await reconcileSemanticReviews(new Date(now.getTime() + 31_000));
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(row.progressPayload).toMatchObject({ semanticReview: { dispatchAttempt: 2, recoveryAttempt: 1, deadlineAt: packet.deadlineAt } });
    await executePersistedSemanticReview("TR-1");
    expect(providerCalls).toBe(1);
    expect(row.status).toBe("completed");
  });

  it("republishes final checkpoints after loss without invoking another provider", async () => {
    await persistedCapacityWait();
    await reconcileSemanticReviews(new Date(Date.now() + 4 * 60_000));
    await executePersistedSemanticReview("TR-1");
    expect(providerCalls).toBe(1);
    mocks.send.mockClear();
    row.status = "working";
    row.lastHeartbeatAt = new Date(Date.now() - 4 * 60_000);
    await reconcileSemanticReviews(new Date(Date.now() + 5 * 60_000));
    expect(mocks.send).toHaveBeenCalledOnce();
    await executePersistedSemanticReview("TR-1");
    expect(providerCalls).toBe(1);
    expect(row.status).toBe("completed");
  });

  it("does not replay an unproven completed inconclusive after executor loss", async () => {
    const nodes = await persistedCapacityWait();
    row.status = "working";
    row.lastHeartbeatAt = new Date(Date.now() - 4 * 60_000);
    const node = nodes.get("semantic-review:TR-1:change-reviewer")!;
    node.outputSnapshot = { requestDigest: packet.digest, providerOutcome: "unknown",
      result: { decision: "inconclusive", issues: [], summary: "Provider response was truncated.", inconclusiveReason: "review-response-truncated" } };
    await reconcileSemanticReviews(new Date(Date.now() + 4 * 60_000));
    expect(mocks.send).not.toHaveBeenCalled();
    expect(row.status).toBe("input-required");
    expect(providerCalls).toBe(0);
  });


});
