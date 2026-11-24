import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  scheduleAgentTaskFor: vi.fn(),
  getScheduledAgentTasksFor: vi.fn(),
  getScheduledReportDiagnosticFor: vi.fn(),
  cancelAgentTaskFor: vi.fn(),
  setAgentTaskActiveFor: vi.fn(),
  rerunAgentTaskFor: vi.fn(),
}));
vi.mock("@/lib/operate/scheduled-jobs/agent-task-core", () => core);

import { scheduledAgentTaskPack } from "./scheduled-agent-task-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "create_scheduled_agent_task",
  "list_scheduled_agent_tasks",
  "cancel_scheduled_agent_task",
  "pause_scheduled_agent_task",
  "resume_scheduled_agent_task",
  "rerun_scheduled_agent_task",
  "configure_scheduled_agent_task_reporting",
];

const EXPECTED_GRANTS: Record<string, string[]> = {
  create_scheduled_agent_task: ["work_capsule_write"],
  cancel_scheduled_agent_task: ["work_capsule_write"],
  list_scheduled_agent_tasks: ["work_capsule_read"],
  pause_scheduled_agent_task: ["work_capsule_write"],
  resume_scheduled_agent_task: ["work_capsule_write"],
  rerun_scheduled_agent_task: ["work_capsule_write"],
  configure_scheduled_agent_task_reporting: ["work_capsule_write"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("scheduled-agent-task pack — registration", () => {
  it("exposes the governed scheduled-agent-task lifecycle tools", () => {
    expect(scheduledAgentTaskPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(scheduledAgentTaskPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/path leakage)", () => {
    for (const d of scheduledAgentTaskPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("lists only an exact selected task through the owner-bound core while retaining the compact prompt", async () => {
    core.getScheduledAgentTasksFor.mockResolvedValue([{ taskId: "selected", prompt: "private ".repeat(100), revision: "a".repeat(64) }]);
    const result = await scheduledAgentTaskPack.handlers.list_scheduled_agent_tasks({ taskId: "selected" }, "owner");
    expect(core.getScheduledAgentTasksFor).toHaveBeenCalledWith("owner", undefined, "selected");
    expect((result.data?.tasks as Array<{ prompt: string }>)[0]!.prompt).toBe("private ".repeat(100).slice(0, 200) + "\u2026");
    expect(result.data?.tasks).toEqual([expect.objectContaining({ revision: "a".repeat(64) })]);
  });
  it.each(["", "   ", 42, null])("does not broaden an invalid exact task selector %j into a bulk list", async taskId => {
    const result = await scheduledAgentTaskPack.handlers.list_scheduled_agent_tasks({ taskId }, "owner");
    expect(result.success).toBe(false);
    expect(core.getScheduledAgentTasksFor).not.toHaveBeenCalled();
  });

  it("preserves requiredCapability, executionMode, and sideEffect metadata verbatim", () => {
    const byName = Object.fromEntries(scheduledAgentTaskPack.definitions.map((d) => [d.name, d]));
    for (const t of EXPECTED_TOOLS) {
      expect(byName[t].requiredCapability, t).toBe("view_operations");
      expect(byName[t].executionMode, t).toBe("immediate");
    }
    expect(byName.create_scheduled_agent_task.sideEffect).toBe(true);
    expect(byName.cancel_scheduled_agent_task.sideEffect).toBe(true);
    expect(byName.list_scheduled_agent_tasks.sideEffect).toBe(false);
    expect(byName.pause_scheduled_agent_task.sideEffect).toBe(true);
    expect(byName.resume_scheduled_agent_task.sideEffect).toBe(true);
    expect(byName.rerun_scheduled_agent_task.sideEffect).toBe(true);
    expect(byName.configure_scheduled_agent_task_reporting.consequence).toBe("authority");
  });

  it("grants mirror agent-grants for every tool", () => {
    for (const t of EXPECTED_TOOLS) {
      expect(scheduledAgentTaskPack.grants[t]).toEqual(EXPECTED_GRANTS[t]);
      expect(isToolAllowedByGrants(t, EXPECTED_GRANTS[t])).toBe(true);
    }
  });
});

describe("scheduled-agent-task pack — handler behavior (delegation preserved)", () => {
  it("create_scheduled_agent_task coerces params, forwards the acting userId, and reports the task id", async () => {
    core.scheduleAgentTaskFor.mockResolvedValue({ success: true, taskId: "agent-task-abc123" });
    const res = await scheduledAgentTaskPack.handlers.create_scheduled_agent_task(
      { agentId: "platform-engineer", title: "Nightly sweep", prompt: "Sweep the estate", schedule: "0 9 * * *" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("agent-task-abc123");
    expect(res.message).toContain("agent-task-abc123 created");
    expect(core.scheduleAgentTaskFor).toHaveBeenCalledWith("u1", {
      agentId: "platform-engineer",
      title: "Nightly sweep",
      prompt: "Sweep the estate",
      routeContext: "/platform",
      schedule: "0 9 * * *",
      timezone: undefined,
      // BI-5087F34F: every job records WHY it exists. A caller that names no
      // trigger still gets one — "time" is what a cron-created job IS.
      taskConfig: { trigger: expect.objectContaining({ kind: "time" }) },
    });
  });

  // The record is unconditional precisely because it used to be optional: of 53
  // live tasks only 13 carried a trigger, and none of the 12 ACTIVE ones did.
  it("records a trigger even when the caller supplies none", async () => {
    core.scheduleAgentTaskFor.mockResolvedValue({ success: true, taskId: "agent-task-1" });
    await scheduledAgentTaskPack.handlers.create_scheduled_agent_task(
      { agentId: "a", title: "t", prompt: "p", schedule: "0 9 * * *" },
      "u1",
    );
    const trigger = core.scheduleAgentTaskFor.mock.calls[0][1].taskConfig.trigger;
    expect(trigger.kind).toBe("time");
    expect(typeof trigger.recordedAt).toBe("string");
    // Absent facts stay absent — a default kind must not invent a room or a deadline.
    expect(trigger.workroomId).toBeUndefined();
    expect(trigger.obligation).toBeUndefined();
  });

  it("preserves a caller's own trigger, room and obligation", async () => {
    const futureDueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    core.scheduleAgentTaskFor.mockResolvedValue({ success: true, taskId: "agent-task-2" });
    await scheduledAgentTaskPack.handlers.create_scheduled_agent_task(
      {
        agentId: "a",
        title: "t",
        prompt: "p",
        schedule: "0 9 * * *",
        trigger: {
          kind: "detected-need",
          workroomId: "WC-1",
          // Relative, not absolute: this asserts PASS-THROUGH, so the instant is
          // irrelevant — but a hardcoded future date silently becomes a past one
          // and starts testing something else.
          obligation: { dueAt: futureDueAt, label: "Q3 filing" },
        },
      },
      "u1",
    );
    const trigger = core.scheduleAgentTaskFor.mock.calls[0][1].taskConfig.trigger;
    expect(trigger.kind).toBe("detected-need");
    expect(trigger.workroomId).toBe("WC-1");
    expect(trigger.obligation.dueAt).toBe(futureDueAt);
  });

  it("create_scheduled_agent_task appends a de-confliction note and honors a supplied routeContext", async () => {
    core.scheduleAgentTaskFor.mockResolvedValue({ success: true, taskId: "agent-task-def456", note: "shifted to 09:05" });
    const res = await scheduledAgentTaskPack.handlers.create_scheduled_agent_task(
      { agentId: "a", title: "t", prompt: "p", schedule: "0 9 * * *", routeContext: "/operate" },
      "u2",
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("(shifted to 09:05)");
    expect(core.scheduleAgentTaskFor.mock.calls[0][1].routeContext).toBe("/operate");
  });

  it("forwards typed Product scope and previewed playbook config", async () => {
    core.scheduleAgentTaskFor.mockResolvedValue({
      success: true,
      taskId: "agent-task-pm",
    });
    const taskConfig = {
      schemaVersion: 1,
      recipeId: "roadmap-refresh",
      permissionsDigest: "pm-permissions-123",
      minimumRefreshMinutes: 60,
    };
    await scheduledAgentTaskPack.handlers.create_scheduled_agent_task(
      {
        agentId: "portfolio-advisor",
        title: "Refresh roadmap",
        prompt: "Prepared by the typed recipe.",
        schedule: "0 9 * * 4",
        organizationId: "org-1",
        businessProductId: "product-1",
        taskKind: "product-management-playbook",
        taskConfig,
      },
      "u1",
    );
    expect(core.scheduleAgentTaskFor).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        organizationId: "org-1",
        businessProductId: "product-1",
        taskKind: "product-management-playbook",
        // The typed playbook config is preserved verbatim; the trigger is merged
        // alongside it rather than replacing it.
        taskConfig: expect.objectContaining({
          ...taskConfig,
          trigger: expect.objectContaining({ kind: "time" }),
        }),
      }),
    );
  });

  it("create_scheduled_agent_task surfaces a scheduling failure as an error", async () => {
    core.scheduleAgentTaskFor.mockResolvedValue({ success: false, error: "Non-UTC timezones are not yet supported." });
    const res = await scheduledAgentTaskPack.handlers.create_scheduled_agent_task(
      { agentId: "a", title: "t", prompt: "p", schedule: "0 9 * * *" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Non-UTC timezones are not yet supported.");
    expect(res.message).toBe("Non-UTC timezones are not yet supported.");
  });

  it("list_scheduled_agent_tasks scopes compact census to the caller without prompts", async () => {
    const longPrompt = "x".repeat(250);
    core.getScheduledAgentTasksFor.mockResolvedValue([
      { taskId: "agent-task-1", agentId: "a", title: "t", prompt: longPrompt, schedule: "0 9 * * *", isActive: true, nextRunAt: null, lastRunAt: null, lastStatus: null },
      { taskId: "agent-task-2", agentId: "a", title: "t2", prompt: "short", schedule: "0 8 * * *", isActive: true, nextRunAt: null, lastRunAt: null, lastStatus: null },
    ]);
    const res = await scheduledAgentTaskPack.handlers.list_scheduled_agent_tasks({}, "u1");
    expect(res.success).toBe(true);
    expect(res.data?.total).toBe(2);
    expect(core.getScheduledAgentTasksFor).toHaveBeenCalledWith("u1");
    const tasks = (res.data as { tasks: Array<{ prompt: string }> }).tasks;
    expect(tasks[0]).not.toHaveProperty("prompt");
    expect(tasks[1]).not.toHaveProperty("prompt");
  });

  it("cancel_scheduled_agent_task requires a taskId", async () => {
    const res = await scheduledAgentTaskPack.handlers.cancel_scheduled_agent_task({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("taskId is required.");
    expect(core.cancelAgentTaskFor).not.toHaveBeenCalled();
  });

  it("cancel_scheduled_agent_task forwards owner + id and confirms cancellation", async () => {
    core.cancelAgentTaskFor.mockResolvedValue({ success: true });
    const res = await scheduledAgentTaskPack.handlers.cancel_scheduled_agent_task({ taskId: "agent-task-9" }, "u1");
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("agent-task-9");
    expect(res.message).toContain("agent-task-9 cancelled");
    expect(core.cancelAgentTaskFor).toHaveBeenCalledWith("u1", "agent-task-9");
  });

  it("cancel_scheduled_agent_task surfaces an ownership/not-found failure", async () => {
    core.cancelAgentTaskFor.mockResolvedValue({ success: false, error: "Not authorized to cancel this scheduled agent task" });
    const res = await scheduledAgentTaskPack.handlers.cancel_scheduled_agent_task({ taskId: "agent-task-x" }, "u2");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Not authorized to cancel this scheduled agent task");
  });

  it("pauses, resumes, and queues reruns through the ownership-checked core", async () => {
    core.setAgentTaskActiveFor.mockResolvedValue({ success: true });
    core.rerunAgentTaskFor.mockResolvedValue({ success: true });

    await scheduledAgentTaskPack.handlers.pause_scheduled_agent_task(
      { taskId: "agent-task-1" },
      "u1",
    );
    await scheduledAgentTaskPack.handlers.resume_scheduled_agent_task(
      { taskId: "agent-task-1" },
      "u1",
    );
    await scheduledAgentTaskPack.handlers.rerun_scheduled_agent_task(
      { taskId: "agent-task-1" },
      "u1",
    );

    expect(core.setAgentTaskActiveFor).toHaveBeenNthCalledWith(
      1,
      "u1",
      "agent-task-1",
      false,
    );
    expect(core.setAgentTaskActiveFor).toHaveBeenNthCalledWith(
      2,
      "u1",
      "agent-task-1",
      true,
    );
    expect(core.rerunAgentTaskFor).toHaveBeenCalledWith(
      "u1",
      "agent-task-1",
    );
  });
});

it("reads an exact bounded report diagnostic using the authenticated owner and no prompt list",async()=>{
 core.getScheduledReportDiagnosticFor.mockResolvedValue({taskId:"watch",taskRunId:"TR-OLD",retention:"not-retained"});
 const reportDiagnostic={taskRunId:"TR-OLD",expectedRevision:"a".repeat(64)};
 const result=await scheduledAgentTaskPack.handlers.list_scheduled_agent_tasks({taskId:"watch",reportDiagnostic},"owner");
 expect(result.success).toBe(true);
 expect(core.getScheduledReportDiagnosticFor).toHaveBeenCalledWith("owner","watch",reportDiagnostic);
 expect(core.getScheduledAgentTasksFor).not.toHaveBeenCalled();
});
it.each([{reportDiagnostic:{}},{taskId:"watch",reportDiagnostic:{taskRunId:"TR-X",expectedRevision:"invalid"}},{taskId:"watch",reportDiagnostic:{taskRunId:"TR-X",expectedRevision:"a".repeat(64),raw:true}}])("never broadens invalid diagnostics into task listings %j",async params=>{
 const result=await scheduledAgentTaskPack.handlers.list_scheduled_agent_tasks(params,"owner");
 expect(result.success).toBe(false);expect(core.getScheduledAgentTasksFor).not.toHaveBeenCalled();
});

describe("bounded scheduled task census", () => {
  const rows = Array.from({ length: 7 }, (_, n) => ({
    taskId: "task-" + n, agentId: "a", title: "Task " + n, prompt: "private".repeat(500),
    schedule: "0 9 * * *", isActive: true, revision: String(n), taskKind: "workroom-stage",
    taskConfig: { checkpoint: "x".repeat(100000) },
  }));
  it("traverses bounded compact pages without exposing prompts or checkpoints", async () => {
    core.getScheduledAgentTasksFor.mockResolvedValue([...rows].reverse());
    let cursor: unknown; const ids: string[] = [];
    do {
      const r = await scheduledAgentTaskPack.handlers.list_scheduled_agent_tasks({ limit: 2, ...(cursor ? { cursor } : {}) }, "owner");
      expect(r.success).toBe(true);
      expect(JSON.stringify(r).length).toBeLessThan(20000);
      expect(r.data?.total).toBe(7);
      const page = r.data?.tasks as Array<Record<string, unknown>>;
      expect(page.length).toBeLessThanOrEqual(2);
      for (const row of page) { expect(row).not.toHaveProperty("prompt"); expect(row).not.toHaveProperty("taskConfig"); ids.push(String(row.taskId)); }
      cursor = r.data?.nextCursor;
      expect(r.data?.complete).toBe(!cursor);
    } while (cursor);
    expect(ids).toEqual(rows.map(r => r.taskId));
    expect(core.getScheduledAgentTasksFor).toHaveBeenCalledWith("owner");
  });
  it("rejects a cursor reused by another owner or after inventory changes", async () => {
    core.getScheduledAgentTasksFor.mockResolvedValue(rows);
    const first = await scheduledAgentTaskPack.handlers.list_scheduled_agent_tasks({ limit: 2 }, "owner");
    expect(first.data?.nextCursor).toBeTruthy();
    const stolen = await scheduledAgentTaskPack.handlers.list_scheduled_agent_tasks({ limit: 2, cursor: first.data?.nextCursor }, "other-owner");
    expect(stolen.success).toBe(false);
    core.getScheduledAgentTasksFor.mockResolvedValue(rows.map((row, index) => index === 0 ? { ...row, revision: "changed" } : row));
    const revised = await scheduledAgentTaskPack.handlers.list_scheduled_agent_tasks({ limit: 2, cursor: first.data?.nextCursor }, "owner");
    expect(revised.success).toBe(false);
    core.getScheduledAgentTasksFor.mockResolvedValue(rows.slice(1));
    const stale = await scheduledAgentTaskPack.handlers.list_scheduled_agent_tasks({ limit: 2, cursor: first.data?.nextCursor }, "owner");
    expect(stale.success).toBe(false);
  });
});

it("binds cursors to product scope and applies inventory filters", async () => {
  const row = { taskId: "mine-one", title: "Watch one", agentId: "agent", taskKind: "workroom-stage", isActive: true, prompt: "secret", revision: "r" };
  core.getScheduledAgentTasksFor.mockResolvedValue([row, { ...row, taskId: "mine-two" }]);
  const args = { organizationId: "org-one", taskIdPrefix: "mine-", agentId: "agent", isActive: true, limit: 1 };
  const first = await scheduledAgentTaskPack.handlers.list_scheduled_agent_tasks(args, "owner");
  expect(core.getScheduledAgentTasksFor).toHaveBeenCalledWith("owner", { organizationId: "org-one", productLineId: null, businessProductId: null }, undefined);
  expect(first.data?.nextCursor).toBeTruthy();
  const changedScope = await scheduledAgentTaskPack.handlers.list_scheduled_agent_tasks({ ...args, organizationId: "org-two", cursor: first.data?.nextCursor }, "owner");
  expect(changedScope.success).toBe(false);
  const none = await scheduledAgentTaskPack.handlers.list_scheduled_agent_tasks({ taskIdPrefix: "other-" }, "owner");
  expect(none.data).toMatchObject({ total: 0, complete: true, nextCursor: null, tasks: [] });
});
it.each([0, -1, 51, 1.5, "2"])("rejects invalid inventory limit %j", async limit => {
  core.getScheduledAgentTasksFor.mockResolvedValue([]);
  const r = await scheduledAgentTaskPack.handlers.list_scheduled_agent_tasks({ limit }, "owner");
  expect(r.success).toBe(false);
});
