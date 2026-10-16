import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ workroom: { findUnique: vi.fn() }, workroomActivity: { findMany: vi.fn() },
  taskRun: { findMany: vi.fn() }, $queryRaw: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: db }));

import { getWorkCapsuleTool } from "./mcp-handlers";
import { clampToolResultForModel, MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";

const now = new Date();
const room = { id: "room-row", capsuleId: "WC-1", title: "Review recovery", objective: "Expose recorded review state",
  repositoryFullName: "owner/repo", headBranch: "fix/readback", worktreePath: "D:/readback",
  baseSha: "0".repeat(40), headSha: "1".repeat(40), taskRun: null, activities: [] };

describe("get_workroom native review readback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.workroom.findUnique.mockResolvedValue(room);
    db.workroomActivity.findMany.mockResolvedValue([]);
    db.taskRun.findMany.mockResolvedValue([{ id: "review-row", taskRunId: "TR-REVIEW", userId: "requester-1",
      status: "working", updatedAt: now, lastHeartbeatAt: now,
      progressPayload: { privateProviderOutput: "must-not-escape", semanticReview: { schemaVersion: 1,
        deadlineAt: new Date(now.getTime() + 60_000).toISOString(), recoveryAttempt: 0 } }, nodes: [] }]);
    db.$queryRaw.mockResolvedValue([{ rowId: "review-row", capsuleId: "WC-1", requestBound: true,
      requesterAgentId: "AGT-EXT-CODEX", sourceHeadSha: room.headSha, currentHeadSha: room.headSha,
      issuedAt: new Date(now.getTime() - 1_000).toISOString() }]);
  });

  it("exposes metadata-linked execution without leaking the private task payload", async () => {
    const result = await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1");
    expect(result).toMatchObject({ success: true, data: { capsule: { recovery: { state: "working",
      reviewerExecution: { taskRunId: "TR-REVIEW", pending: true, accountableOwner: { agentId: "AGT-EXT-CODEX" } } } } } });
    expect(db.taskRun.findMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
  });

  it("returns the recorded final result and keeps full receipts behind tasks/result authorization", async () => {
    db.taskRun.findMany.mockResolvedValue([{ id: "review-row", taskRunId: "TR-REVIEW", userId: "requester-1",
      status: "completed", updatedAt: now, lastHeartbeatAt: now, progressPayload: {}, nodes: [] }]);
    db.$queryRaw.mockResolvedValue([{ rowId: "review-row", capsuleId: "WC-1", requestBound: true,
      sourceHeadSha: room.headSha, currentHeadSha: room.headSha, issuedAt: new Date(now.getTime() - 1_000).toISOString(),
      receiptId: "receipt-1", receiptDecision: "pass", receiptSummary: "Native review passed.", receiptCreatedAt: now }]);
    const result = await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1");
    expect(result).toMatchObject({ data: { capsule: { recovery: { state: "terminal", reviewerExecution: {
      receipt: { id: "receipt-1", decision: "pass" },
      resultAction: { method: "tasks/result", params: { taskId: "TR-REVIEW" }, requiredUserId: "requester-1" },
    } } } } });
  });

  it("keeps unreadable review state unknown while retaining the room", async () => {
    db.taskRun.findMany.mockRejectedValue(new Error("review source unavailable"));
    expect(await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1")).toMatchObject({ success: true,
      data: { capsule: { recovery: { state: "unknown", blocker: { reason: "review-observation-incomplete" } } } } });
  });

  it("does not read review records for a missing room", async () => {
    db.workroom.findUnique.mockResolvedValue(null);
    expect(await getWorkCapsuleTool({ capsuleId: "WC-MISSING" }, "requester-1")).toMatchObject({ success: false, error: "not_found" });
    expect(db.taskRun.findMany).not.toHaveBeenCalled();
  });

  it("retains exact source and ownership plus recovery when bulky room history exceeds the route budget", async () => {
    const ownership = { leaseHolderPrincipalId: "PRN-OWNER", leaseExpiresAt: now, updatedAt: now, executorRef: "session-1" };
    db.workroom.findUnique.mockResolvedValue({ ...room, ...ownership, activitySequence: 123,
      activities: [{ payload: "x".repeat(150_000) }], workspaceState: { trace: "y".repeat(150_000) } });
    const result = await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1");
    expect(JSON.stringify(result.data).length).toBeLessThanOrEqual(100_000);
    expect(result).toMatchObject({ success: true, data: { capsule: { ...ownership, capsuleId: "WC-1",
      repositoryFullName: room.repositoryFullName, baseSha: room.baseSha, headSha: room.headSha,
      worktreePath: room.worktreePath, activitySequence: 123, recovery: { state: "working" } },
      omittedFields: expect.arrayContaining(["capsule.activities", "capsule.workspaceState"]) } });
  });

  it("keeps an oversized activity page explicitly incomplete without advancing its cursor", async () => {
    db.workroomActivity.findMany.mockResolvedValue([{ sequence: 1, payload: "x".repeat(150_000) }]);
    const result = await getWorkCapsuleTool({ capsuleId: "WC-1", afterSequence: 0 }, "requester-1");
    expect(JSON.stringify(result.data).length).toBeLessThanOrEqual(100_000);
    expect(result).toMatchObject({ success: true, data: { capsule: { recovery: { state: "working" } },
      log: { afterSequence: 0, activity: [], hasMore: true, incomplete: true, reason: "activity-page-budget-exceeded" } } });
  });

  it("keeps current recovery parseable at the actual model-facing response boundary", async () => {
    const ownership = { leaseHolderPrincipalId: "PRN-OWNER", leaseExpiresAt: now, updatedAt: now, executorRef: "session-1" };
    db.workroom.findUnique.mockResolvedValue({ ...room, ...ownership, workspaceState: "" });
    const empty = await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1");
    const padding = MCP_ROUTE_TOOL_RESULT_CHAR_CAP - JSON.stringify(empty.data).length;
    db.workroom.findUnique.mockResolvedValue({ ...room, ...ownership, workspaceState: "x".repeat(padding) });
    const result = await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1");
    const formatted = clampToolResultForModel(result, { maxChars: MCP_ROUTE_TOOL_RESULT_CHAR_CAP });
    expect(formatted.truncated).toBe(false);
    const readback = JSON.parse(formatted.text.slice(formatted.text.indexOf("\n") + 1));
    expect(readback).toMatchObject({ capsule: { ...ownership, leaseExpiresAt: now.toISOString(), updatedAt: now.toISOString(),
      headSha: room.headSha, worktreePath: room.worktreePath, recovery: { state: "working" } },
      omittedFields: expect.arrayContaining(["capsule.workspaceState"]) });
  });

  it("reports an explicit failure when exact identity itself cannot fit, instead of returning a truncated identity", async () => {
    db.workroom.findUnique.mockResolvedValue({ ...room, worktreePath: "x".repeat(150_000) });
    expect(await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1")).toMatchObject({
      success: false, error: "workroom_recovery_budget_exceeded" });
  });
});
