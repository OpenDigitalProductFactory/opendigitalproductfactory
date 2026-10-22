import { describe, expect, it } from "vitest";

import {
  CLIENT_CAPABILITY_REVERIFY_AGENT_ID,
  CLIENT_CAPABILITY_REVERIFY_SCHEDULE,
  CLIENT_CAPABILITY_REVERIFY_TASK_ID,
  CLIENT_CAPABILITY_REVERIFY_TASK_KIND,
} from "./client-capability-reverify-config";
import { ensureClientCapabilityReverifyScheduledTask } from "./seed-client-capability-reverify";

// BI-64795FD0: the weekly client-capability re-verification is registered on
// the existing scheduled-agent-task substrate, and re-seeding never wipes the
// run state it keeps in taskConfig.

type Row = Record<string, unknown>;

function fakePrisma() {
  const tasks = new Map<string, Row>();
  const jobs = new Map<string, Row>();
  const client = {
    // No accountable owner recorded: the seed falls back to the superuser guess (BI-F0E946D2).
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

describe("ensureClientCapabilityReverifyScheduledTask", () => {
  it("registers a weekly deterministic task owned by the Enterprise Architect", async () => {
    const { client, tasks, jobs } = fakePrisma();
    await expect(ensureClientCapabilityReverifyScheduledTask(client, new Date("2026-10-13T00:00:00Z"))).resolves.toEqual({ created: true });
    const task = tasks.get(CLIENT_CAPABILITY_REVERIFY_TASK_ID)!;
    expect(task.taskKind).toBe(CLIENT_CAPABILITY_REVERIFY_TASK_KIND);
    expect(task.taskKind).toBe("client-capability-reverify");
    expect(task.agentId).toBe(CLIENT_CAPABILITY_REVERIFY_AGENT_ID);
    expect(task.schedule).toBe(CLIENT_CAPABILITY_REVERIFY_SCHEDULE);
    expect(CLIENT_CAPABILITY_REVERIFY_SCHEDULE.split(" ")).toHaveLength(5);
    expect(CLIENT_CAPABILITY_REVERIFY_SCHEDULE.split(" ")[4]).toMatch(/^[0-6]$/);
    expect(task.prompt).toMatch(/never edits the profile/i);
    expect(jobs.has(CLIENT_CAPABILITY_REVERIFY_TASK_ID)).toBe(true);
  });

  it("keeps the run state in taskConfig when it re-seeds", async () => {
    const { client, tasks } = fakePrisma();
    await ensureClientCapabilityReverifyScheduledTask(client, new Date("2026-10-13T00:00:00Z"));
    const state = { clientCapability: { schemaVersion: 1, consecutiveFailedRuns: 1, notified: false, clients: {} } };
    tasks.set(CLIENT_CAPABILITY_REVERIFY_TASK_ID, { ...tasks.get(CLIENT_CAPABILITY_REVERIFY_TASK_ID), taskConfig: state });
    await expect(ensureClientCapabilityReverifyScheduledTask(client, new Date("2026-10-14T00:00:00Z"))).resolves.toEqual({ created: false });
    expect(tasks.get(CLIENT_CAPABILITY_REVERIFY_TASK_ID)!.taskConfig).toEqual(state);
  });
});
