import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ task: vi.fn(), collect: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findUnique: mocks.task } } }));
vi.mock("@/lib/inference/async-operation-runtime", () => ({
  readPrismaAuthorizedAsyncOperation: vi.fn(),
  requestPrismaAuthorizedAsyncOperationCancellation: vi.fn(),
}));
vi.mock("../mcp-task-original-result", () => ({ readOriginalReviewResult: mocks.collect }));

import { handleTasksResult } from "./tasks-lifecycle";

const row = {
  taskRunId: "TR-ORIGINAL", userId: "owner", title: "private title", objective: "private prompt",
  status: "input-required", progressPayload: { executionUncertainty: { settlement: "unknown" }, raw: "private output" },
  a2aMetadata: { initiativeReviewBinding: { itemId: "BI-ORIGINAL" } },
  createdAt: new Date("2026-10-18"), updatedAt: new Date("2026-10-18"), completedAt: null,
};
const projection = {
  schemaVersion: 1, taskRunId: row.taskRunId, classification: "unknown", readOnly: true,
  replayAllowed: false, reason: "Child closure is unverified.", observations: [],
  missingProof: ["child-closure"], bounded: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.task.mockResolvedValue(row);
  mocks.collect.mockResolvedValue(projection);
});

it("returns bounded original evidence using server auth and never raw task output", async () => {
  const actor = { actingAgentId: "AGT-EXT-CODEX", tokenGrantScopes: ["backlog_read"] };
  const result = await handleTasksResult("owner", { taskId: row.taskRunId,
    requestDigest: "digest", actingAgentId: "AGT-OTHER", tokenGrantScopes: ["admin"] }, actor);
  expect(mocks.collect).toHaveBeenCalledWith({ taskRunId: row.taskRunId, userId: "owner",
    ...actor, expected: { requestDigest: "digest" } });
  expect(result).toMatchObject({ kind: "ok", value: { isError: false,
    structuredContent: { taskId: row.taskRunId, status: "input_required", terminal: false,
      originalResult: projection, requiresApproval: false, resumable: false } } });
  expect(JSON.stringify(result)).not.toContain("private");
  expect(JSON.stringify(result)).not.toContain("Poll tasks/get");
});

it("projects a matching receipt without healing status or authorizing replay", async () => {
  mocks.collect.mockResolvedValue({ ...projection, classification: "receipt-complete",
    reason: "Matching receipt recorded.", receipt: { receiptId: "receipt", decision: "fail" }, missingProof: [] });
  expect(await handleTasksResult("owner", { taskId: row.taskRunId })).toMatchObject({
    kind: "ok", value: { structuredContent: { status: "input_required", terminal: false,
      resumable: false, originalResult: { classification: "receipt-complete", receipt: { decision: "fail" } } } },
  });
  expect(mocks.task).toHaveBeenCalledTimes(1);
});

it("does not let a terminal original task bypass protected collection", async () => {
  mocks.task.mockResolvedValue({ ...row, status: "completed" });
  const result = await handleTasksResult("owner", { taskId: row.taskRunId });
  expect(result).toMatchObject({ kind: "ok", value: { structuredContent: { terminal: true, originalResult: projection } } });
  expect(JSON.stringify(result)).not.toContain("private");
});

it("rejects another owner before collecting observations", async () => {
  expect(await handleTasksResult("other", { taskId: row.taskRunId })).toMatchObject({ kind: "forbidden" });
  expect(mocks.collect).not.toHaveBeenCalled();
});
