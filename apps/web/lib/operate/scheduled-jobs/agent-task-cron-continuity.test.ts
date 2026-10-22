// BI-0A82D3B4: accepted step crons must keep their cadence through the real
// management and admission paths, without replacing the existing monitor.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  scheduledAgentTask: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  scheduledJob: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: vi.fn() } }));

import { claimScheduledTaskCadence } from "@/lib/actions/agent-task-claim";
import { setAgentTaskActiveFor } from "./agent-task-core";
import { setWorkEnabled, updateWorkSchedule } from "./control";

const TASK_ID = "agent-task-56e05d88";
const OWNER_ID = "monitor-owner";
const CRON = "23 */6 * * *";
const RESUME_AT = new Date("2026-10-18T19:44:22.000Z");
const FIRST_FIRE = new Date("2026-10-19T00:23:00.000Z");

type TaskRow = {
  taskId: string;
  ownerUserId: string;
  agentId: string;
  title: string;
  prompt: string;
  routeContext: string;
  timezone: string;
  schedule: string;
  isActive: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date;
  lastStatus: string;
  lastError: string;
  lastThreadId: string;
  taskRunId: string;
  attempts: number;
  taskConfig: Record<string, unknown>;
};

type JobRow = {
  jobId: string;
  name: string;
  schedule: string;
  enabled: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date;
  lastStatus: string;
  lastError: string;
  locked: boolean;
  category: string;
  metadata: Record<string, unknown>;
};

let taskRow: TaskRow;
let jobRow: JobRow;

// Only the mocked Prisma methods below touch these rows. Cron projection,
// ownership checks, mutation policy and the guarded cadence claim run for real.
const claimDb = db as unknown as Parameters<typeof claimScheduledTaskCadence>[0];

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(RESUME_AT);
  taskRow = {
    taskId: TASK_ID,
    ownerUserId: OWNER_ID,
    agentId: "AGT-WS-PLATFORM",
    title: "AI Ops local LLM performance and learning",
    prompt: "Maintain local LLM performance and durable learning.",
    routeContext: "/platform/ai/operations",
    timezone: "UTC",
    schedule: CRON,
    isActive: false,
    nextRunAt: null,
    lastRunAt: new Date("2026-10-18T17:10:00.358Z"),
    lastStatus: "error",
    lastError: "Prior run failure retained for diagnosis",
    lastThreadId: "existing-monitor-thread",
    taskRunId: "TR-EXISTING-MONITOR",
    attempts: 1,
    taskConfig: {
      trigger: { kind: "user-request", recordedAt: "2026-10-18T17:06:42.474Z" },
    },
  };
  jobRow = {
    jobId: TASK_ID,
    name: taskRow.title,
    schedule: CRON,
    enabled: false,
    nextRunAt: null,
    lastRunAt: taskRow.lastRunAt,
    lastStatus: taskRow.lastStatus,
    lastError: taskRow.lastError,
    locked: false,
    category: "editable",
    metadata: { monitorCommission: "existing-commission", lastEditedBy: "previous-editor" },
  };

  db.scheduledAgentTask.findUnique.mockImplementation(async ({ where }: { where: { taskId: string } }) =>
    where.taskId === taskRow.taskId ? structuredClone(taskRow) : null,
  );
  db.scheduledAgentTask.update.mockImplementation(async ({ where, data }: {
    where: { taskId: string };
    data: Partial<TaskRow>;
  }) => {
    if (where.taskId !== taskRow.taskId) throw new Error("Unexpected monitor identity");
    taskRow = { ...taskRow, ...data };
    return structuredClone(taskRow);
  });
  db.scheduledAgentTask.updateMany.mockImplementation(async ({ where, data }: {
    where: { taskId: string; isActive: boolean; nextRunAt: { lte: Date } };
    data: Partial<TaskRow>;
  }) => {
    if (where.taskId !== taskRow.taskId || taskRow.isActive !== where.isActive ||
      !taskRow.nextRunAt || taskRow.nextRunAt > where.nextRunAt.lte) return { count: 0 };
    taskRow = { ...taskRow, ...data };
    return { count: 1 };
  });
  db.scheduledJob.findUnique.mockImplementation(async ({ where }: { where: { jobId: string } }) =>
    where.jobId === jobRow.jobId ? structuredClone(jobRow) : null,
  );
  db.scheduledJob.update.mockImplementation(async ({ where, data }: {
    where: { jobId: string };
    data: Partial<JobRow>;
  }) => {
    if (where.jobId !== jobRow.jobId) throw new Error("Unexpected mirror identity");
    jobRow = { ...jobRow, ...data };
    return structuredClone(jobRow);
  });
  db.scheduledJob.updateMany.mockImplementation(async ({ where, data }: {
    where: { jobId: string };
    data: Partial<JobRow>;
  }) => {
    if (where.jobId !== jobRow.jobId) return { count: 0 };
    jobRow = { ...jobRow, ...data };
    return { count: 1 };
  });
  db.scheduledJob.upsert.mockImplementation(async ({ where, update }: {
    where: { jobId: string };
    update: Partial<JobRow>;
  }) => {
    if (where.jobId !== jobRow.jobId) throw new Error("Existing monitor mirror must be reused");
    jobRow = { ...jobRow, ...update };
    return structuredClone(jobRow);
  });
});

afterEach(() => {
  vi.useRealTimers();
  expect(db.scheduledAgentTask.create).not.toHaveBeenCalled();
});

describe("BI-0A82D3B4 scheduled-agent cron continuity", () => {
  it("resumes the existing monitor at the next six-hour UTC fire and keeps its history", async () => {
    const taskBefore = structuredClone(taskRow);
    const jobBefore = structuredClone(jobRow);

    expect(await setAgentTaskActiveFor(OWNER_ID, TASK_ID, true)).toEqual({ success: true });

    expect(taskRow).toEqual({ ...taskBefore, isActive: true, nextRunAt: FIRST_FIRE });
    // MCP Resume's existing contract synchronizes nextRunAt only. The register
    // and dispatcher read task.isActive, so the mirror's legacy enabled flag
    // remains unchanged; this cadence fix does not claim to repair that flag.
    expect(jobRow).toEqual({ ...jobBefore, nextRunAt: FIRST_FIRE });
    expect(db.scheduledAgentTask.update).toHaveBeenCalledWith({
      where: { taskId: TASK_ID },
      data: { isActive: true, nextRunAt: FIRST_FIRE },
    });
  });

  it("resaving the unchanged cadence repairs its next fire without replacing the monitor", async () => {
    taskRow.isActive = true;
    taskRow.nextRunAt = new Date("2026-10-19T19:44:22.000Z");
    const taskBefore = structuredClone(taskRow);
    const jobBefore = structuredClone(jobRow);

    expect((await updateWorkSchedule(TASK_ID, CRON, OWNER_ID)).ok).toBe(true);

    expect(taskRow).toEqual({ ...taskBefore, nextRunAt: FIRST_FIRE });
    expect(jobRow).toEqual({
      ...jobBefore,
      enabled: true,
      nextRunAt: FIRST_FIRE,
      metadata: {
        ...jobBefore.metadata,
        lastEditedBy: OWNER_ID,
        lastEditedAt: RESUME_AT.toISOString(),
        lastAction: "update-schedule",
      },
    });
  });

  it("enabling the existing monitor uses the same six-hour UTC projection and retains its commission", async () => {
    const taskBefore = structuredClone(taskRow);
    const jobBefore = structuredClone(jobRow);

    expect((await setWorkEnabled(TASK_ID, true, OWNER_ID)).ok).toBe(true);

    expect(taskRow).toEqual({ ...taskBefore, isActive: true, nextRunAt: FIRST_FIRE });
    expect(jobRow).toEqual({
      ...jobBefore,
      enabled: true,
      nextRunAt: FIRST_FIRE,
      metadata: {
        ...jobBefore.metadata,
        lastEditedBy: OWNER_ID,
        lastEditedAt: RESUME_AT.toISOString(),
        lastAction: "enable",
      },
    });
  });

  it("repeated due claims progress through 00:23, 06:23, 12:23, 18:23 and the next 00:23 UTC", async () => {
    taskRow.isActive = true;
    taskRow.nextRunAt = new Date("2026-10-18T18:23:00.000Z");
    jobRow.enabled = true;
    jobRow.nextRunAt = taskRow.nextRunAt;
    const taskBefore = structuredClone(taskRow);
    const jobBefore = structuredClone(jobRow);
    const ticks = [
      ["2026-10-18T19:44:22.000Z", "2026-10-19T00:23:00.000Z"],
      ["2026-10-19T00:23:00.000Z", "2026-10-19T06:23:00.000Z"],
      ["2026-10-19T06:23:00.000Z", "2026-10-19T12:23:00.000Z"],
      ["2026-10-19T12:23:00.000Z", "2026-10-19T18:23:00.000Z"],
      ["2026-10-19T18:23:00.000Z", "2026-10-20T00:23:00.000Z"],
    ] as const;

    for (const [dueAt, nextAt] of ticks) {
      const now = new Date(dueAt);
      const nextRunAt = new Date(nextAt);
      expect(await claimScheduledTaskCadence(claimDb, taskRow, now)).toBe(true);
      expect(taskRow).toEqual({ ...taskBefore, nextRunAt });
      expect(jobRow).toEqual({ ...jobBefore, nextRunAt });
      expect(db.scheduledAgentTask.updateMany).toHaveBeenLastCalledWith({
        where: { taskId: TASK_ID, isActive: true, nextRunAt: { lte: now } },
        data: { nextRunAt },
      });
    }
    expect(db.scheduledJob.updateMany).toHaveBeenCalledTimes(ticks.length);
  });

  it("refuses another owner's resume without altering either row", async () => {
    const taskBefore = structuredClone(taskRow);
    const jobBefore = structuredClone(jobRow);

    expect(await setAgentTaskActiveFor("another-owner", TASK_ID, true)).toEqual({
      success: false,
      error: "Not authorized to change this scheduled agent task",
    });

    expect(taskRow).toEqual(taskBefore);
    expect(jobRow).toEqual(jobBefore);
    expect(db.scheduledAgentTask.update).not.toHaveBeenCalled();
    expect(db.scheduledJob.update).not.toHaveBeenCalled();
  });

  it("does not admit an inactive monitor or update its mirror", async () => {
    taskRow.nextRunAt = new Date("2026-10-18T18:23:00.000Z");
    const taskBefore = structuredClone(taskRow);
    const jobBefore = structuredClone(jobRow);

    expect(await claimScheduledTaskCadence(claimDb, taskRow, RESUME_AT)).toBe(false);

    expect(taskRow).toEqual(taskBefore);
    expect(jobRow).toEqual(jobBefore);
    expect(db.scheduledJob.updateMany).not.toHaveBeenCalled();
  });

  it("does not consume a future tick or update the mirror when the due claim is lost", async () => {
    taskRow.isActive = true;
    taskRow.nextRunAt = FIRST_FIRE;
    const taskBefore = structuredClone(taskRow);
    const jobBefore = structuredClone(jobRow);

    expect(await claimScheduledTaskCadence(claimDb, taskRow, RESUME_AT)).toBe(false);

    expect(taskRow).toEqual(taskBefore);
    expect(jobRow).toEqual(jobBefore);
    expect(db.scheduledJob.updateMany).not.toHaveBeenCalled();
  });

  it("keeps one-shot admission semantics: deactivate after the due date without rearming", async () => {
    taskRow.schedule = "23 0 19 10 *";
    taskRow.isActive = true;
    taskRow.nextRunAt = FIRST_FIRE;
    jobRow.schedule = taskRow.schedule;
    jobRow.enabled = true;
    jobRow.nextRunAt = FIRST_FIRE;
    const taskBefore = structuredClone(taskRow);
    const jobBefore = structuredClone(jobRow);

    expect(await claimScheduledTaskCadence(claimDb, taskRow, FIRST_FIRE)).toBe(true);

    expect(taskRow).toEqual({ ...taskBefore, isActive: false, nextRunAt: null });
    expect(jobRow).toEqual({ ...jobBefore, nextRunAt: null });
    expect(db.scheduledAgentTask.updateMany).toHaveBeenCalledWith({
      where: { taskId: TASK_ID, isActive: true, nextRunAt: { lte: FIRST_FIRE } },
      data: { isActive: false, nextRunAt: null },
    });
  });
});
