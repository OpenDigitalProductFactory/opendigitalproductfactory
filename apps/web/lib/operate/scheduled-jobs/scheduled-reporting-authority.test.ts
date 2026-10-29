import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ taskRun: { findUnique: vi.fn() }, scheduledAgentTask: { findUnique: vi.fn() } }));
vi.mock("@dpf/db", () => ({ prisma: db, DATA_MODEL_MIRROR_TASK_ID: "data-mirror", SYSML_PROJECTION_TASK_ID: "sysml", SELF_OPTIMIZATION_SWEEP_TASK_ID: "optimization" }));
import { scheduledReportingScopeDigest } from "./scheduled-reporting-contract";
import { scheduledReportingToolRefusal as currentReportingRefusal } from "./scheduled-reporting-authority";

const definitions = [
  { name: "observe_health", description: "Read", inputSchema: {}, requiredCapability: null, sideEffect: false, executionMode: "immediate" as const },
  { name: "record_execution_evidence", description: "Write", inputSchema: {}, requiredCapability: null, sideEffect: true, executionMode: "immediate" as const },
  { name: "unknown_metadata", description: "Unknown", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const },
];
const scheduledReportingToolRefusal = (name: string, user: string, context: Parameters<typeof currentReportingRefusal>[2]) =>
  currentReportingRefusal(name, user, context, definitions.find(tool => tool.name === name));

let task: Record<string, unknown>;
let run: Record<string, unknown>;
const context = { taskRunId: "TR-WATCH", agentId: "platform-engineer", threadId: "thread", callerClient: "approval-completion" };
describe("current scheduled reporting authority", () => {
  beforeEach(() => {
    task = { taskId: "agent-task-56e05d88", ownerUserId: "owner", agentId: "platform-engineer", prompt: "Original bounded watch", schedule: "23 */6 * * *", timezone: "UTC",
      taskRunId: "TR-WATCH", nextRunAt: null, isActive: true, taskKind: null, taskConfig: { routineReporting: { version: 1, mode: "read-only-history" } } };
    run = { taskRunId: "TR-WATCH", userId: "owner", threadId: "thread", currentAgentId: "platform-engineer", status: "working",
      a2aMetadata: { sourceRef: { kind: "scheduled-task", id: task.taskId }, scheduledReporting: { mode: "read-only-history", scopeDigest: scheduledReportingScopeDigest(task), nextRunAt: null } } };
    db.taskRun.findUnique.mockReset().mockImplementation(async () => run);
    db.scheduledAgentTask.findUnique.mockReset().mockImplementation(async () => task);
  });
  it("allows only current explicit reads under normal remaining authority checks", async () => {
    expect(await scheduledReportingToolRefusal("observe_health", "owner", context)).toBeNull();
    expect(await scheduledReportingToolRefusal("unknown_metadata", "owner", context)).toMatchObject({ success: false });
  });
  it("denies an old approved operational writer even through approval completion", async () => {
    expect(await scheduledReportingToolRefusal("record_execution_evidence", "owner", context)).toMatchObject({ success: false, error: "scheduled_reporting_write_refused" });
  });
  it.each([
    { ownerUserId: "foreign" }, { taskRunId: "TR-NEWER" }, { isActive: false },
    { prompt: "Changed commission" }, { agentId: "another-agent" }, { nextRunAt: new Date(Date.now() + 60000) },
  ])("refuses stale or foreign current task state %j", async change => {
    Object.assign(task, change);
    expect(await scheduledReportingToolRefusal("observe_health", "owner", context)).toMatchObject({ success: false });
  });
  it.each([
    { threadId: "foreign-thread" }, { agentId: "another-agent" }, { taskRunId: "TR-CHILD" },
  ])("rejects forged caller context %j", async change => {
    expect(await scheduledReportingToolRefusal("observe_health", "owner", { ...context, ...change })).toMatchObject({ success: false });
  });
  it("refuses stale legacy scheduled writes with no new reporting admission", async () => {
    run.a2aMetadata = { sourceRef: { kind: "scheduled-task", id: task.taskId } };
    expect(await scheduledReportingToolRefusal("record_execution_evidence", "owner", context)).toMatchObject({ success: false });
  });
  it("does not apply a reporting policy to an unrelated ordinary task", async () => {
    run.a2aMetadata = { sourceRef: { kind: "human-request", id: "ordinary" } };
    expect(await scheduledReportingToolRefusal("record_execution_evidence", "owner", context)).toBeNull();
    expect(db.scheduledAgentTask.findUnique).not.toHaveBeenCalled();
  });
});
