import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), transaction: vi.fn(), lock: vi.fn() }));
const scope = vi.hoisted(() => ({ restricted: false, readOnly: false }));
vi.mock("@dpf/db", () => ({ prisma: { $transaction: db.transaction } }));
vi.mock("@/lib/routing/reassessment-execution-scope", () => ({ currentReassessmentExecution: () => scope.restricted ? {} : undefined }));
vi.mock("./read-evidence-policy", () => ({ currentReadEvidencePolicy: () => scope.readOnly ? {} : undefined }));
import { evidenceRecoveryFailure, retainUnverifiedEvidenceDraft } from "./evidence-recovery-artifact";
import { captureTaskExecutionFence } from "@/lib/shared/task-execution-fence";

const digest = "a".repeat(64);
const input = { taskRunId: "TR-current", userId: "human", agentId: "coo", threadId: "thread-current",
  withheldContent: "Unverified operational claim. Must not reach outward response or progress summaries.",
  taskExecutionFence: captureTaskExecutionFence(null, digest)! };
const row = () => ({ id: "task-row", userId: input.userId, currentAgentId: input.agentId,
  threadId: input.threadId, archivedAt: null, status: "working", progressPayload: null, a2aMetadata: { requestDigest: digest } });

beforeEach(() => {
  vi.clearAllMocks(); scope.restricted = false; scope.readOnly = false;
  db.read.mockResolvedValue(row()); db.write.mockResolvedValue({});
  db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({
    taskRun: { findUnique: db.read }, taskArtifact: { upsert: db.write }, $queryRaw: db.lock,
  }));
});

describe("unverified evidence diagnostic retention", () => {
  it("stores a labelled diagnostic only on the exact currently authorized task generation", async () => {
    expect(await retainUnverifiedEvidenceDraft(input)).toMatchObject({ state: "stored", artifactId: expect.any(String) });
    expect(db.read).toHaveBeenCalledWith(expect.objectContaining({ where: { taskRunId: "TR-current" } }));
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(db.lock.mock.invocationCallOrder[0]).toBeLessThan(db.read.mock.invocationCallOrder[0]!);
    const saved = db.write.mock.calls[0]![0].create;
    expect(saved).toMatchObject({ taskRunId: "task-row", producerAgentId: "coo", metadata: {
      kind: "unverified-evidence-draft", state: "unverified", usableAsEvidence: false,
    } });
    expect(JSON.stringify(saved.parts)).toContain(input.withheldContent);
    expect(saved.name + saved.description).not.toContain(input.withheldContent);
  });
  it.each([{ taskRunId: undefined }, { taskExecutionFence: undefined }])("does not infer a current task from history (%j)", async patch => {
    expect(await retainUnverifiedEvidenceDraft({ ...input, ...patch })).toEqual({ state: "unavailable", reason: "missing-task-binding" });
    expect(db.read).not.toHaveBeenCalled(); expect(db.write).not.toHaveBeenCalled();
  });
  it.each([
    { userId: "another-human" }, { currentAgentId: "inventory-specialist" }, { threadId: "other-thread" },
    { archivedAt: new Date() }, { status: "failed" }, { status: "input-required" },
    { progressPayload: { resumeReservedAt: "new-generation" } },
    { a2aMetadata: { requestDigest: "b".repeat(64) } },
  ])("refuses a foreign, terminal or changed task generation (%j)", async patch => {
    db.read.mockResolvedValue({ ...row(), ...patch });
    expect(await retainUnverifiedEvidenceDraft(input)).toEqual({ state: "unavailable", reason: "task-binding-mismatch" });
    expect(db.write).not.toHaveBeenCalled();
  });
  it.each(["restricted", "readOnly"] as const)("keeps %s execution inside its admitted writer surface", async key => {
    scope[key] = true;
    expect(await retainUnverifiedEvidenceDraft(input)).toEqual({ state: "unavailable", reason: "restricted-execution" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("does not claim retention when the write acknowledgment is unavailable", async () => {
    db.write.mockRejectedValue(new Error("write acknowledgment unavailable"));
    expect(await retainUnverifiedEvidenceDraft(input)).toEqual({ state: "unavailable", reason: "write-failed" });
  });
});


describe("uncertain execution precedence", () => {
  it.each([
    { executionUncertainty: { schemaVersion: 99 } },
    { data: { executionUncertainty: { settlement: "unknown" } } },
    { error: "execution_uncertain" },
    { error: "execution-uncertain" },
    { name: "NativeCliExecutionUncertainError", message: "unknown" },
  ])("preserves unknown settlement without writing an artifact: %j", async marker => {
    const result = await evidenceRecoveryFailure({ ...input, message: "Evidence unavailable", drafts: [input.withheldContent],
      toolResults: [{ success: false, ...marker }], observedToolExecutions: 1, observedSuccessfulToolExecutions: 0, recoveryNudges: 1 });
    expect(result.failure).toMatchObject({ kind: "execution-uncertain", executionUncertainty: { settlement: "unknown" } });
    expect(result.evidenceFailure?.retention).toEqual({ state: "unavailable", reason: "execution-uncertain" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
