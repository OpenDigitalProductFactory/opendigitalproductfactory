import { createHash } from "node:crypto";
import { beforeEach, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { taskRun: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    runtimeVerification: { findUnique: vi.fn() }, taskArtifact: { findUnique: vi.fn() }, taskNode: { findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    workroom: { findUnique: vi.fn() }, $transaction: vi.fn() },
  reserve: vi.fn(), authority: vi.fn(), dispatch: vi.fn(), evidence: vi.fn(), activity: vi.fn(), publish: vi.fn(), send: vi.fn(),
  resolveFailureEvidence: vi.fn(),
}));
export { mocks };
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
vi.mock("./failure-analysis-evidence", () => ({ resolveFailureAnalysisEvidence: mocks.resolveFailureEvidence }));
vi.mock("./failure-readiness-status", () => ({ publishFailureReadinessStatus: vi.fn() }));
import { createSemanticReviewRequest } from "./semantic-review-request";
import { failureAnalysisFixture } from "./failure-analysis.test-fixtures";

export const result = { decision: "pass", failureAnalysisReview: { adequate: true, rationale: "Challenged stale evidence and recovery paths against the executed test." }, issues: [], summary: "Exact diff reviewed." };
export const state = { row: {} as Record<string, unknown>, packet: {} as ReturnType<typeof createSemanticReviewRequest>, providerCalls: 0, transactionCommitted: false };
beforeEach(() => {
  vi.clearAllMocks(); state.providerCalls = 0; state.transactionCommitted = false;
  vi.mocked(getQuiescenceLevel).mockResolvedValue("normal");
  state.packet = createSemanticReviewRequest({ surface: "external", authorSurface: "codex", artifactType: "code-change",
    title: "Review", artifact: "diff", changedFiles: ["a.ts"], verificationEvidence: "Tests passed",
    ...failureAnalysisFixture({ capsuleId: "WC-1", headTreeHash: "b".repeat(40), diffDigest: createHash("sha256").update("diff").digest("hex") }),
    identity: { capsuleId: "WC-1", baseTreeHash: "a".repeat(40), headTreeHash: "b".repeat(40),
      diffDigest: createHash("sha256").update("diff").digest("hex"), specialistIds: [] },
  }, { userId: "user-1", agentId: null, apiTokenId: "token-1", authSource: "pat" });
  state.row = { id: "run-row-1", taskRunId: "TR-1", userId: "user-1", status: "submitted", updatedAt: new Date(),
    a2aMetadata: { gateKind: "semantic-review", gateKey: state.packet.gateKey, capsuleId: "WC-1" },
    progressPayload: { semanticReview: { schemaVersion: 1, requestDigest: state.packet.digest, deadlineAt: state.packet.deadlineAt, dispatchAttempt: 0 } } };
  mocks.db.taskRun.findUnique.mockImplementation(async () => ({ ...state.row }));
  mocks.db.taskRun.findMany.mockResolvedValue([]);
  mocks.db.taskRun.create.mockImplementation(async ({ data }) => ({ ...data, createdAt: new Date() }));
  mocks.db.runtimeVerification.findUnique.mockResolvedValue(null);
  mocks.db.taskNode.findMany.mockResolvedValue([]);
  mocks.db.taskNode.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.taskArtifact.findUnique.mockResolvedValue({ taskRunId: "run-row-1", parts: [{ kind: "data", data: state.packet }] });
  mocks.db.taskRun.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.status && state.row.status !== (typeof where.status === "string" ? where.status : where.status.equals)) return { count: 0 };
    if (where.updatedAt && state.row.updatedAt !== where.updatedAt) return { count: 0 };
    const current = state.row.progressPayload as { semanticReview: { generation?: string } };
    if (where.progressPayload && current.semanticReview.generation !== where.progressPayload.equals) return { count: 0 };
    Object.assign(state.row, data, { updatedAt: new Date() }); return { count: 1 };
  });
  mocks.db.taskRun.update.mockImplementation(async ({ data }) => { Object.assign(state.row, data); return state.row; });
  mocks.reserve.mockImplementation(async ({ progressPayload }) => {
    if (state.row.status !== "submitted") return false;
    Object.assign(state.row, { status: "working", progressPayload }); return true;
  });
  mocks.db.$transaction.mockImplementation(async (fn) => {
    state.transactionCommitted = false;
    const value = await fn(mocks.db); state.transactionCommitted = true; return value;
  });
  mocks.publish.mockImplementation(() => { expect(state.transactionCommitted).toBe(true); });
  mocks.authority.mockResolvedValue(true);
  mocks.resolveFailureEvidence.mockResolvedValue(state.packet.input.resolvedFailureEvidence);
  mocks.db.taskNode.findUnique.mockResolvedValue(null);
  mocks.db.taskNode.findFirst.mockResolvedValue(null);
  mocks.db.taskNode.create.mockResolvedValue({ id: "node-new" });
  mocks.db.taskNode.update.mockReset().mockResolvedValue({});
  mocks.db.workroom.findUnique.mockResolvedValue({ id: "room-1" });
  mocks.evidence.mockResolvedValue({ id: "evidence-1" });
  mocks.activity.mockResolvedValue({ id: "activity-1" });
  mocks.dispatch.mockImplementation(async (_prompt, _context, branch) => branch("change-reviewer", async () => {
    state.providerCalls += 1; return result;
  }));
  mocks.send.mockResolvedValue(undefined);
});

