import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  taskRun: { findUnique: vi.fn() },
  coworkerActionEnvelope: { findFirst: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/inference/async-operation-runtime", () => ({
  readPrismaAuthorizedAsyncOperation: vi.fn(),
  requestPrismaAuthorizedAsyncOperationCancellation: vi.fn(),
}));
import { handleTasksGet, handleTasksResult } from "./tasks-lifecycle";

const row = {
  taskRunId: "TR-REVIEW", userId: "owner", title: "Review", objective: "Review evidence",
  status: "input-required", progressPayload: {}, a2aMetadata: {},
  createdAt: new Date("2026-09-01"), updatedAt: new Date("2026-09-01"), completedAt: null,
};
const wait = {
  schemaVersion: 1, kind: "missing-terminal-writer", writerToolName: "record_initiative_evidence",
  resumeMode: "same-taskrun", attempt: 1, observedAt: "2026-09-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  db.taskRun.findUnique.mockResolvedValue(row);
  db.coworkerActionEnvelope.findFirst.mockResolvedValue(null);
});

describe.each([handleTasksGet, handleTasksResult])("task wait projection (%#)", (handler) => {
  async function read() {
    const result = await handler("owner", { taskId: row.taskRunId });
    expect(result.kind).toBe("ok");
    const value = (result as { value: Record<string, unknown> }).value;
    return (value.structuredContent ?? value) as Record<string, unknown>;
  }

  it("reports the existing technical recovery rather than a nonexistent approval", async () => {
    db.taskRun.findUnique.mockResolvedValue({ ...row, progressPayload: { terminalWriterWait: wait } });
    expect(await read()).toMatchObject({ requiresApproval: false, resumable: true, waitReason: "missing-terminal-writer" });
  });

  it("does not invent approval for unspecified input or authentication", async () => {
    expect(await read()).toMatchObject({ requiresApproval: false });
    db.taskRun.findUnique.mockResolvedValue({ ...row, status: "auth-required" });
    expect(await read()).toMatchObject({ requiresApproval: false });
  });

  it("projects provider capacity as a same-task technical wait", async () => {
    db.taskRun.findUnique.mockResolvedValue({ ...row, progressPayload: { resourceWait: {
      schemaVersion: 1, kind: "provider-capacity", failureKind: "busy",
      resumeMode: "same-taskrun", attempt: 1, observedAt: wait.observedAt,
    } } });
    expect(await read()).toMatchObject({ requiresApproval: false, resumable: true, waitReason: "provider-capacity" });
  });

  it("reports exhausted recovery without offering another replay or approval", async () => {
    db.taskRun.findUnique.mockResolvedValue({ ...row, progressPayload: { terminalWriterWait: { ...wait, attempt: 3 } } });
    expect(await read()).toMatchObject({ requiresApproval: false, resumable: false, waitReason: "terminal-writer-retry-exhausted" });
  });

  it("preserves a genuine live approval location", async () => {
    db.taskRun.findUnique.mockResolvedValue({ ...row, progressPayload: { approvalEnvelopeId: "approval-1" } });
    db.coworkerActionEnvelope.findFirst.mockResolvedValue({
      id: "approval-1", delegatingUserId: "owner", taskRunId: row.taskRunId,
      status: "proposed", expiresAt: new Date("2099-01-01"),
    });
    expect(await read()).toMatchObject({ requiresApproval: true });
  });

  it("does not turn a stale envelope reference into a live approval", async () => {
    db.taskRun.findUnique.mockResolvedValue({ ...row, progressPayload: { approvalEnvelopeId: "expired" } });
    expect(await read()).toMatchObject({ requiresApproval: false });
  });

  it("rejects another caller before reading any approval", async () => {
    expect(await handler("other-user", { taskId: row.taskRunId })).toMatchObject({ kind: "forbidden" });
    expect(db.coworkerActionEnvelope.findFirst).not.toHaveBeenCalled();
  });
});
