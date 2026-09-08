// apps/web/lib/mcp/tasks-lifecycle.test.ts
import { beforeEach, describe, it, expect, vi } from "vitest";
const db = vi.hoisted(() => ({ taskRun: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  externalEvidenceRecord: { findFirst: vi.fn() } }));
vi.mock("@dpf/db", () => ({ prisma: db }));
import {
  mcpTaskStateForWire,
  isTerminalTaskStatus,
  shouldAdvertiseTasksCapability,
  tasksLifecycleEnabled,
  handleTasksCancel,
  handleTasksResult,
} from "./tasks-lifecycle";

describe("tasks-lifecycle state adapter (Slice 4 Phase 0)", () => {
  it("maps DPF/A2A statuses to MCP-spec wire states", () => {
    expect(mcpTaskStateForWire("submitted")).toBe("working");
    expect(mcpTaskStateForWire("working")).toBe("working");
    expect(mcpTaskStateForWire("input-required")).toBe("input_required");
    expect(mcpTaskStateForWire("auth-required")).toBe("input_required");
    expect(mcpTaskStateForWire("completed")).toBe("completed");
    expect(mcpTaskStateForWire("failed")).toBe("failed");
    expect(mcpTaskStateForWire("canceled")).toBe("cancelled");
    expect(mcpTaskStateForWire("rejected")).toBe("failed");
    expect(mcpTaskStateForWire("archived")).toBe("completed");
  });

  it("defaults an unknown status to working (never throws)", () => {
    expect(mcpTaskStateForWire("something-new")).toBe("working");
  });

  it("classifies terminal vs non-terminal statuses", () => {
    for (const s of ["completed", "failed", "canceled", "rejected", "archived"]) {
      expect(isTerminalTaskStatus(s)).toBe(true);
    }
    for (const s of ["submitted", "working", "input-required", "auth-required"]) {
      expect(isTerminalTaskStatus(s)).toBe(false);
    }
  });

  it("is enabled unless MCP_TASKS_LIFECYCLE=off", () => {
    const prev = process.env.MCP_TASKS_LIFECYCLE;
    delete process.env.MCP_TASKS_LIFECYCLE;
    expect(tasksLifecycleEnabled()).toBe(true);
    process.env.MCP_TASKS_LIFECYCLE = "off";
    expect(tasksLifecycleEnabled()).toBe(false);
    if (prev === undefined) delete process.env.MCP_TASKS_LIFECYCLE;
    else process.env.MCP_TASKS_LIFECYCLE = prev;
  });

  it("advertises tasks only on Tasks-aware protocol versions when the flag is on", () => {
    const prev = process.env.MCP_TASKS_LIFECYCLE;
    delete process.env.MCP_TASKS_LIFECYCLE;
    // Pre-Tasks clients (Grok Build 1.0.0 → 2025-06-18, older SDKs) — never advertise.
    expect(shouldAdvertiseTasksCapability("2024-11-05")).toBe(false);
    expect(shouldAdvertiseTasksCapability("2025-03-26")).toBe(false);
    expect(shouldAdvertiseTasksCapability("2025-06-18")).toBe(false);
    // Tasks-aware negotiation may advertise.
    expect(shouldAdvertiseTasksCapability("2025-11-25")).toBe(true);
    process.env.MCP_TASKS_LIFECYCLE = "off";
    expect(shouldAdvertiseTasksCapability("2025-11-25")).toBe(false);
    if (prev === undefined) delete process.env.MCP_TASKS_LIFECYCLE;
    else process.env.MCP_TASKS_LIFECYCLE = prev;
  });
});

describe("semantic review task lifecycle", () => {
  const now = new Date("2026-09-07T05:00:00Z");
  const row = { taskRunId: "TR-REVIEW", userId: "user-1", title: "Review", objective: "Review exact diff",
    status: "completed", createdAt: now, updatedAt: now, completedAt: now,
    a2aMetadata: { gateKind: "semantic-review", capsuleId: "WC-1" },
    progressPayload: { evidenceRecordId: "receipt-1", semanticReview: { schemaVersion: 1, state: "completed" } } };
  beforeEach(() => { vi.clearAllMocks(); db.taskRun.findUnique.mockResolvedValue(row); });
  it("loads the canonical receipt through the caller, task, and Workroom binding", async () => {
    const receipt = { schemaVersion: "semantic-change-review-receipt.v2", result: { decision: "pass" } };
    db.externalEvidenceRecord.findFirst.mockResolvedValue({ id: "receipt-1", details: receipt, createdAt: now });
    const result = await handleTasksResult("user-1", { taskId: "TR-REVIEW" });
    expect(db.externalEvidenceRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: "receipt-1", actorUserId: "user-1", taskRunId: "TR-REVIEW",
      operationType: "semantic-change-review.receipt", workCapsule: { capsuleId: "WC-1" },
    } }));
    expect(result).toMatchObject({ kind: "ok", value: { structuredContent: {
      evidence: { id: "receipt-1", receipt, state: "available" },
    } } });
  });
  it("reports a missing canonical receipt instead of implying the projection proves completion", async () => {
    db.externalEvidenceRecord.findFirst.mockResolvedValue(null);
    expect(await handleTasksResult("user-1", { taskId: "TR-REVIEW" })).toMatchObject({ kind: "ok", value: {
      structuredContent: { evidence: { id: "receipt-1", state: "unavailable" } },
    } });
  });
  it("never reads receipt data for another caller", async () => {
    expect(await handleTasksResult("user-2", { taskId: "TR-REVIEW" })).toMatchObject({ kind: "forbidden" });
    expect(db.externalEvidenceRecord.findFirst).not.toHaveBeenCalled();
  });
  it("preserves completion when it wins a concurrent cancellation", async () => {
    db.taskRun.findUnique.mockResolvedValueOnce({ ...row, status: "working", completedAt: null }).mockResolvedValue(row);
    db.taskRun.updateMany.mockResolvedValue({ count: 0 });
    expect(await handleTasksCancel("user-1", { taskId: "TR-REVIEW" })).toMatchObject({ kind: "ok", value: { status: "completed" } });
    expect(db.taskRun.update).not.toHaveBeenCalled();
    expect(db.taskRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      taskRunId: "TR-REVIEW", userId: "user-1", status: "working", updatedAt: now,
    } }));
  });
});
