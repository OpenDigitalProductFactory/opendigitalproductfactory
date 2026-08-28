import { describe, expect, it } from "vitest";

import { ensureBookkeepingCycleScheduledTask } from "./seed-bookkeeping-cycle";
import {
  BOOKKEEPING_CYCLE_AGENT_ID,
  BOOKKEEPING_CYCLE_SCHEDULE,
  BOOKKEEPING_CYCLE_TASK_ID,
  BOOKKEEPING_CYCLE_TASK_KIND,
} from "./bookkeeping-cycle-config";

type Row = Record<string, unknown>;

/** Minimal in-memory stand-in for the three tables the seed touches. */
function fakePrisma(opts: { hasSuperuser?: boolean } = {}) {
  const hasSuperuser = opts.hasSuperuser ?? true;
  const tasks = new Map<string, Row>();
  const jobs = new Map<string, Row>();
  const client = {
    user: {
      findFirst: async () => (hasSuperuser ? { id: "user-super" } : null),
    },
    scheduledAgentTask: {
      findUnique: async ({ where }: { where: { taskId: string } }) => tasks.get(where.taskId) ?? null,
      create: async ({ data }: { data: Row }) => {
        tasks.set(data.taskId as string, { ...data });
        return data;
      },
      update: async ({ where, data }: { where: { taskId: string }; data: Row }) => {
        tasks.set(where.taskId, { ...tasks.get(where.taskId), ...data });
        return data;
      },
    },
    scheduledJob: {
      upsert: async ({ where, create, update }: { where: { jobId: string }; create: Row; update: Row }) => {
        const existing = jobs.get(where.jobId);
        jobs.set(where.jobId, existing ? { ...existing, ...update } : { ...create });
        return jobs.get(where.jobId)!;
      },
    },
  };
  return { client: client as never, tasks, jobs };
}

describe("ensureBookkeepingCycleScheduledTask", () => {
  it("seeds the weekly bookkeeping-cycle task with the right kind, agent, and cadence", async () => {
    const { client, tasks, jobs } = fakePrisma();
    const result = await ensureBookkeepingCycleScheduledTask(client, new Date("2026-08-24T00:00:00.000Z"));

    expect(result.created).toBe(true);
    const task = tasks.get(BOOKKEEPING_CYCLE_TASK_ID)!;
    expect(task.taskKind).toBe(BOOKKEEPING_CYCLE_TASK_KIND);
    expect(task.agentId).toBe(BOOKKEEPING_CYCLE_AGENT_ID);
    expect(task.schedule).toBe(BOOKKEEPING_CYCLE_SCHEDULE);
    expect(task.ownerUserId).toBe("user-super");
    expect(task.nextRunAt).toBeInstanceOf(Date);
    expect(jobs.get(BOOKKEEPING_CYCLE_TASK_ID)).toBeTruthy();
  });

  it("is idempotent — a second run updates rather than duplicating", async () => {
    const { client, tasks } = fakePrisma();
    await ensureBookkeepingCycleScheduledTask(client, new Date("2026-08-24T00:00:00.000Z"));
    const second = await ensureBookkeepingCycleScheduledTask(client, new Date("2026-08-31T00:00:00.000Z"));

    expect(second.created).toBe(false);
    expect(tasks.size).toBe(1);
    expect(tasks.get(BOOKKEEPING_CYCLE_TASK_ID)!.taskKind).toBe(BOOKKEEPING_CYCLE_TASK_KIND);
  });

  it("refuses to seed when no superuser owner exists", async () => {
    const { client } = fakePrisma({ hasSuperuser: false });
    await expect(ensureBookkeepingCycleScheduledTask(client)).rejects.toThrow(/no superuser/);
  });
});
