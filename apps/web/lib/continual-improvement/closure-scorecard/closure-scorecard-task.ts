// The deterministic executor for the daily `closure-scorecard` scheduled task
// (BI-97C56E20). Mirrors executeHarnessEvolutionLoopTask: a typed kind off the
// LLM path, one proactive TaskRun per UTC day, its result an artifact on that
// run. It compares the trailing week with the run recorded seven days earlier,
// so a fix shows as a change of direction.

import { randomUUID } from "node:crypto";

import { prisma, type Prisma } from "@dpf/db";

import { computeNextCronRun } from "@/lib/operate/cron-next-run";

import { loadClosureCounts } from "./load-closure-counts";
import {
  computeClosureScorecard,
  describeClosureScorecard,
  type ClosureCounts,
  type ClosureScorecard,
} from "./measures";

export const CLOSURE_SCORECARD_ARTIFACT_KIND = "closure-scorecard";
const WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;

export type ClosureScorecardArtifact = {
  periodKey: string;
  window: { since: string; until: string };
  counts: ClosureCounts;
  previousPeriodKey: string;
  previousFound: boolean;
  scorecard: ClosureScorecard;
};

export interface ClosureScorecardStore {
  findRun(repeatedPatternKey: string): Promise<{ taskRunId: string } | null>;
  /** The counts recorded by an earlier run, or null when that run is missing or unreadable. */
  findCounts(repeatedPatternKey: string): Promise<ClosureCounts | null>;
  loadCounts(window: { since: Date; until: Date }): Promise<ClosureCounts>;
  recordRun(input: {
    ownerUserId: string;
    agentId: string;
    taskId: string;
    periodKey: string;
    repeatedPatternKey: string;
    summary: string;
    artifact: ClosureScorecardArtifact;
    completedAt: Date;
  }): Promise<{ taskRunId: string }>;
}

/** UTC calendar day: one scorecard per day. */
export function closureScorecardPeriodKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function closureScorecardPatternKey(periodKey: string): string {
  return `closure-scorecard:${periodKey}`;
}

function isCounts(value: unknown): value is ClosureCounts {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return ["builds", "signals", "proposals", "escalations", "decisions", "acceptance", "backlog", "selfFiled"]
    .every((key) => v[key] !== null && typeof v[key] === "object");
}

/** Read an artifact's counts back; anything malformed counts as no baseline. */
export function countsFromArtifactParts(parts: unknown): ClosureCounts | null {
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: unknown; data?: unknown };
    if (p.type !== CLOSURE_SCORECARD_ARTIFACT_KIND || !p.data || typeof p.data !== "object") continue;
    const counts = (p.data as { counts?: unknown }).counts;
    if (isCounts(counts)) return counts;
  }
  return null;
}

export const prismaClosureScorecardStore: ClosureScorecardStore = {
  async findRun(repeatedPatternKey) {
    return prisma.taskRun.findFirst({ where: { repeatedPatternKey }, select: { taskRunId: true } });
  },

  async findCounts(repeatedPatternKey) {
    const run = await prisma.taskRun.findFirst({ where: { repeatedPatternKey }, select: { id: true } });
    if (!run) return null;
    const artifact = await prisma.taskArtifact.findFirst({ where: { taskRunId: run.id }, select: { parts: true } });
    return artifact ? countsFromArtifactParts(artifact.parts) : null;
  },

  loadCounts: (window) => loadClosureCounts(window),

  async recordRun(input) {
    const taskRun = await prisma.taskRun.create({
      data: {
        taskRunId: `TR-CSC-${randomUUID().slice(0, 8).toUpperCase()}`,
        userId: input.ownerUserId,
        title: `Closure scorecard ${input.periodKey}`,
        objective: "Measure whether platform work finished at least what it started over the trailing week.",
        source: "proactive",
        status: "completed",
        authorityScope: [],
        a2aMetadata: { trigger: "closure-scorecard", scheduledTaskId: input.taskId },
        initiatingAgentId: input.agentId,
        currentAgentId: null,
        routeContext: "/platform/ai/skills",
        repeatedPatternKey: input.repeatedPatternKey,
        progressPayload: { summary: input.summary } as Prisma.InputJsonValue,
        completedAt: input.completedAt,
      },
      select: { id: true, taskRunId: true },
    });
    await prisma.taskArtifact.create({
      data: {
        id: randomUUID(),
        artifactId: `ta_${randomUUID()}`,
        taskRunId: taskRun.id,
        name: "Closure scorecard",
        description: input.summary,
        // Widen through `unknown`: counts carry `null` ages, which Prisma's
        // InputJsonValue type excludes although null is valid JSON.
        parts: [{ type: CLOSURE_SCORECARD_ARTIFACT_KIND, mimeType: "application/json", data: input.artifact }] as unknown as Prisma.InputJsonValue,
        metadata: { kind: CLOSURE_SCORECARD_ARTIFACT_KIND, periodKey: input.periodKey },
      },
    });
    return { taskRunId: taskRun.taskRunId };
  },
};

export type ClosureScorecardRunResult =
  | { idempotent: true; periodKey: string; taskRunId: string }
  | { idempotent: false; periodKey: string; taskRunId: string; summary: string; artifact: ClosureScorecardArtifact };

export async function runClosureScorecard(
  store: ClosureScorecardStore,
  input: { ownerUserId: string; agentId: string; taskId: string; now: Date },
): Promise<ClosureScorecardRunResult> {
  const periodKey = closureScorecardPeriodKey(input.now);
  const repeatedPatternKey = closureScorecardPatternKey(periodKey);
  const existing = await store.findRun(repeatedPatternKey);
  if (existing) return { idempotent: true, periodKey, taskRunId: existing.taskRunId };

  const until = input.now;
  const since = new Date(until.getTime() - WINDOW_DAYS * MS_PER_DAY);
  const previousPeriodKey = closureScorecardPeriodKey(since);
  const [counts, previous] = await Promise.all([
    store.loadCounts({ since, until }),
    store.findCounts(closureScorecardPatternKey(previousPeriodKey)),
  ]);
  const scorecard = computeClosureScorecard(counts, previous);
  const summary = describeClosureScorecard(scorecard);
  const artifact: ClosureScorecardArtifact = {
    periodKey,
    window: { since: since.toISOString(), until: until.toISOString() },
    counts,
    previousPeriodKey,
    previousFound: previous !== null,
    scorecard,
  };
  const run = await store.recordRun({
    ownerUserId: input.ownerUserId,
    agentId: input.agentId,
    taskId: input.taskId,
    periodKey,
    repeatedPatternKey,
    summary,
    artifact,
    completedAt: new Date(),
  });
  return { idempotent: false, periodKey, taskRunId: run.taskRunId, summary, artifact };
}

/** The scheduled-task fields this branch reads. */
export interface ClosureScorecardTask {
  taskId: string;
  schedule: string;
  ownerUserId: string;
  agentId: string;
}

export async function executeClosureScorecardTask(
  task: ClosureScorecardTask,
  deps: { now?: Date; store?: ClosureScorecardStore } = {},
): Promise<void> {
  const startedAt = deps.now ?? new Date();
  const nextRunAt = computeNextCronRun(task.schedule, startedAt);
  try {
    const result = await runClosureScorecard(deps.store ?? prismaClosureScorecardStore, {
      ownerUserId: task.ownerUserId,
      agentId: task.agentId,
      taskId: task.taskId,
      now: startedAt,
    });
    const summary = result.idempotent ? `already recorded for ${result.periodKey} (${result.taskRunId})` : result.summary;
    console.info("[closure-scorecard] %s", summary);
    await prisma.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, nextRunAt, taskRunId: result.taskRunId },
    });
    await prisma.scheduledJob
      .update({
        where: { jobId: task.taskId },
        data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, lastRunSummary: summary.slice(0, 2000), nextRunAt },
      })
      .catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[closure-scorecard] run failed: %s", message);
    await prisma.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: { lastRunAt: startedAt, lastStatus: "error", lastError: message, nextRunAt },
    });
    await prisma.scheduledJob
      .update({
        where: { jobId: task.taskId },
        data: { lastRunAt: startedAt, lastStatus: "error", lastError: message, nextRunAt },
      })
      .catch(() => {});
  }
}
