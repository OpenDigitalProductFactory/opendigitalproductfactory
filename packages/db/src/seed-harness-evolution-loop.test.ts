import { describe, expect, it } from "vitest";

import {
  HARNESS_EVOLUTION_LOOP_AGENT_ID,
  HARNESS_EVOLUTION_LOOP_DEFAULT_CONFIG,
  HARNESS_EVOLUTION_LOOP_SCHEDULE,
  HARNESS_EVOLUTION_LOOP_TASK_ID,
  HARNESS_EVOLUTION_LOOP_TASK_KIND,
} from "./harness-evolution-loop-config";
import { ensureHarnessEvolutionLoopScheduledTask } from "./seed-harness-evolution-loop";

// BI-49BC21C1 (AC-1): every install seeds the daily harness evolution loop as a
// typed task, and re-seeding never overwrites an operator's budget or queue.

type Row = Record<string, unknown>;

function fakePrisma() {
  const tasks = new Map<string, Row>();
  const jobs = new Map<string, Row>();
  const client = {
    portfolio: { findUnique: async () => null },
    organization: { findFirst: async () => null },
    principalAlias: { findFirst: async () => null },
    user: { findFirst: async () => ({ id: "u-superuser" }) },
    scheduledAgentTask: {
      findUnique: async ({ where }: { where: { taskId: string } }) => tasks.get(where.taskId) ?? null,
      create: async ({ data }: { data: Row }) => {
        tasks.set(data.taskId as string, { ...data });
        return data;
      },
      update: async ({ where, data }: { where: { taskId: string }; data: Row }) => {
        const next = { ...tasks.get(where.taskId), ...data };
        tasks.set(where.taskId, next);
        return next;
      },
    },
    scheduledJob: {
      upsert: async ({ where, create, update }: { where: { jobId: string }; create: Row; update: Row }) => {
        jobs.set(where.jobId, { ...(jobs.get(where.jobId) ?? create), ...update });
        return {};
      },
    },
  };
  return { client: client as never, tasks, jobs };
}

describe("ensureHarnessEvolutionLoopScheduledTask", () => {
  it("registers a daily deterministic task for the AI Ops Engineer with a capped budget", async () => {
    const { client, tasks, jobs } = fakePrisma();
    await expect(ensureHarnessEvolutionLoopScheduledTask(client, new Date("2026-10-28T00:00:00Z"))).resolves.toEqual({ created: true });
    const task = tasks.get(HARNESS_EVOLUTION_LOOP_TASK_ID)!;
    expect(task.taskKind).toBe(HARNESS_EVOLUTION_LOOP_TASK_KIND);
    expect(task.taskKind).toBe("harness-evolution-loop");
    expect(task.agentId).toBe(HARNESS_EVOLUTION_LOOP_AGENT_ID);
    expect(task.schedule).toBe(HARNESS_EVOLUTION_LOOP_SCHEDULE);
    expect(HARNESS_EVOLUTION_LOOP_SCHEDULE.split(" ").slice(2)).toEqual(["*", "*", "*"]);
    expect(task.taskConfig).toEqual(HARNESS_EVOLUTION_LOOP_DEFAULT_CONFIG);
    expect(task.prompt).toMatch(/never edits a harness file/i);
    expect(jobs.has(HARNESS_EVOLUTION_LOOP_TASK_ID)).toBe(true);
  });

  it("keeps an operator's taskConfig when it re-seeds", async () => {
    const { client, tasks } = fakePrisma();
    await ensureHarnessEvolutionLoopScheduledTask(client, new Date("2026-10-28T00:00:00Z"));
    const tuned = { maxCandidates: 3, seedItemIds: ["BI-ONLY"] };
    tasks.set(HARNESS_EVOLUTION_LOOP_TASK_ID, { ...tasks.get(HARNESS_EVOLUTION_LOOP_TASK_ID), taskConfig: tuned });
    await expect(ensureHarnessEvolutionLoopScheduledTask(client, new Date("2026-10-29T00:00:00Z"))).resolves.toEqual({ created: false });
    expect(tasks.get(HARNESS_EVOLUTION_LOOP_TASK_ID)!.taskConfig).toEqual(tuned);
  });
});
