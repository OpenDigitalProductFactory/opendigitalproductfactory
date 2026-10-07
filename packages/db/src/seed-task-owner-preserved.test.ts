import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ensureAcceptanceSweepScheduledTask } from "./seed-acceptance-sweep";
import { ensureBookkeepingCycleScheduledTask } from "./seed-bookkeeping-cycle";
import { ensureDataModelMirrorScheduledTask } from "./seed-data-model-mirror";
import { ensureDecisionEngineReviewScheduledTask } from "./seed-decision-engine-review";
import { ensureDiscoveryTriageScheduledTask } from "./seed-discovery-triage";
import { ensureSelfOptimizationSweepScheduledTask } from "./seed-self-optimization-sweep";
import { ensureSysmlProjectionScheduledTask } from "./seed-sysml-projection";

// BI-ED055D45: every upgrade re-runs these seeds. When a task already exists,
// the seed must not hand it back to the oldest superuser; an account handover
// (BI-F25A5FC7) moved them to a real person and the seed undid it.

type Row = Record<string, unknown>;

function fakePrisma() {
  const tasks = new Map<string, Row>();
  const client = {
    user: { findFirst: async () => ({ id: "u-oldest-superuser" }) },
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
    scheduledJob: { upsert: async () => ({}) },
  };
  return { client: client as never, tasks };
}

const SEEDS: Array<[string, (db: never, now?: Date) => Promise<unknown>]> = [
  ["acceptance-sweep", ensureAcceptanceSweepScheduledTask],
  ["bookkeeping-cycle", ensureBookkeepingCycleScheduledTask],
  ["data-model-mirror", ensureDataModelMirrorScheduledTask],
  ["decision-engine-review", ensureDecisionEngineReviewScheduledTask],
  ["discovery-triage", ensureDiscoveryTriageScheduledTask],
  ["self-optimization-sweep", ensureSelfOptimizationSweepScheduledTask],
  ["sysml-projection", ensureSysmlProjectionScheduledTask],
];

describe.each(SEEDS)("%s seed", (_name, seed) => {
  it("creates the task with an owner on first run", async () => {
    const { client, tasks } = fakePrisma();
    await seed(client, new Date("2026-10-01T00:00:00Z"));
    const [task] = [...tasks.values()];
    expect(task.ownerUserId).toBe("u-oldest-superuser");
  });

  it("leaves an existing task's owner alone on a later run", async () => {
    const { client, tasks } = fakePrisma();
    await seed(client, new Date("2026-10-01T00:00:00Z"));
    const [taskId] = [...tasks.keys()];
    tasks.set(taskId, { ...tasks.get(taskId), ownerUserId: "u-handed-over-owner" });

    await seed(client, new Date("2026-10-02T00:00:00Z"));

    expect(tasks.get(taskId)!.ownerUserId).toBe("u-handed-over-owner");
  });
});

// Guard for the next seed: no seed may write ownerUserId when it updates an
// existing scheduled task.
describe("scheduled-task seeds", () => {
  it("never set ownerUserId in a scheduledAgentTask.update", () => {
    const offenders = readdirSync(__dirname)
      .filter((f) => f.startsWith("seed-") && f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => {
        const src = readFileSync(join(__dirname, f), "utf8");
        return [...src.matchAll(/scheduledAgentTask\.update\(\{[\s\S]*?\n {4}\}\);/g)].some((m) => /ownerUserId\s*:/.test(m[0]));
      });
    expect(offenders).toEqual([]);
  });
});
