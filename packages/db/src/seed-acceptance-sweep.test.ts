import { describe, expect, it } from "vitest";

import { ensureAcceptanceSweepScheduledTask } from "./seed-acceptance-sweep";
import {
  ACCEPTANCE_AGED_DAYS,
  ACCEPTANCE_SWEEP_AGENT_ID,
  ACCEPTANCE_SWEEP_PAGE_SIZE,
  ACCEPTANCE_SWEEP_ROUTE_LIMIT,
  ACCEPTANCE_SWEEP_ROUTING,
  ACCEPTANCE_SWEEP_SCHEDULE,
  ACCEPTANCE_SWEEP_TASK_ID,
  ACCEPTANCE_SWEEP_TASK_KIND,
} from "./acceptance-sweep-config";

// AC-S2-1 (BI-DF255666; docs/superpowers/plans/2026-09-24-acceptance-accountability-plan.md
// phase 2): the acceptance sweep is seeded idempotently on every install, in the
// exact shape of the decision-engine review seed.

type Row = Record<string, unknown>;

function fakePrisma(opts: { hasSuperuser?: boolean } = {}) {
  const hasSuperuser = opts.hasSuperuser ?? true;
  const tasks = new Map<string, Row>();
  const jobs = new Map<string, Row>();
  const client = {
    user: { findFirst: async () => (hasSuperuser ? { id: "user-super" } : null) },
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

describe("acceptance sweep config", () => {
  it("holds the plan's values", () => {
    expect(ACCEPTANCE_SWEEP_TASK_ID).toBe("acceptance-sweep-daily");
    expect(ACCEPTANCE_SWEEP_AGENT_ID).toBe("AGT-WS-PORTFOLIO");
    expect(ACCEPTANCE_SWEEP_SCHEDULE).toBe("0 5 * * *");
    expect(ACCEPTANCE_SWEEP_TASK_KIND).toBe("acceptance-sweep");
    expect(ACCEPTANCE_AGED_DAYS).toBe(14);
    expect(ACCEPTANCE_SWEEP_PAGE_SIZE).toBe(100);
    expect(ACCEPTANCE_SWEEP_ROUTE_LIMIT).toBe(10);
    // Routing is phase 3 (BI-C1781121); it stays off until then.
    expect(ACCEPTANCE_SWEEP_ROUTING).toBe(false);
  });
});

describe("ensureAcceptanceSweepScheduledTask", () => {
  it("seeds the daily acceptance-sweep task with its kind, agent and cadence", async () => {
    const { client, tasks, jobs } = fakePrisma();
    const result = await ensureAcceptanceSweepScheduledTask(client, new Date("2026-10-06T04:00:00.000Z"));

    expect(result.created).toBe(true);
    const task = tasks.get(ACCEPTANCE_SWEEP_TASK_ID)!;
    expect(task.taskKind).toBe(ACCEPTANCE_SWEEP_TASK_KIND);
    expect(task.agentId).toBe(ACCEPTANCE_SWEEP_AGENT_ID);
    expect(task.schedule).toBe(ACCEPTANCE_SWEEP_SCHEDULE);
    expect(task.ownerUserId).toBe("user-super");
    expect(task.nextRunAt).toEqual(new Date("2026-10-06T05:00:00.000Z")); // clock-bomb-guard: allow — "now" is injected as 2026-10-06T04:00Z, so the next 05:00 run is fixed
    expect(jobs.get(ACCEPTANCE_SWEEP_TASK_ID)).toMatchObject({ schedule: ACCEPTANCE_SWEEP_SCHEDULE });
  });

  it("is idempotent: a second run updates the one task and keeps its due time", async () => {
    const { client, tasks } = fakePrisma();
    await ensureAcceptanceSweepScheduledTask(client, new Date("2026-10-06T04:00:00.000Z"));
    const second = await ensureAcceptanceSweepScheduledTask(client, new Date("2026-10-07T06:00:00.000Z"));

    expect(second.created).toBe(false);
    expect(tasks.size).toBe(1);
    expect(tasks.get(ACCEPTANCE_SWEEP_TASK_ID)!.nextRunAt).toEqual(new Date("2026-10-06T05:00:00.000Z")); // clock-bomb-guard: allow — both runs inject "now"; the first run's due time is kept
  });

  it("refuses to seed when no superuser owner exists", async () => {
    const { client } = fakePrisma({ hasSuperuser: false });
    await expect(ensureAcceptanceSweepScheduledTask(client)).rejects.toThrow(/no superuser/);
  });
});
