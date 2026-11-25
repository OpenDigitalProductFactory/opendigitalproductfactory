// The deterministic executor for the daily `closure-scorecard` scheduled task
// (BI-97C56E20). Mirrors executeHarnessEvolutionLoopTask: a typed kind off the
// LLM path, its result an artifact on a proactive TaskRun.
//
// One run per UTC day under a unique key: the TaskRun's taskRunId is
// `TR-CSC-<yyyymmdd>` (TaskRun.taskRunId is unique). The run and its artifact
// are written in one transaction, and a run found without its artifact is
// repaired rather than reported as done, so a partial write cannot leave a day
// silently empty. A concurrent second writer loses on the unique key and falls
// through to the same repair-or-idempotent path.

import { randomUUID } from "node:crypto";

import { prisma, type Prisma } from "@dpf/db";

import { computeNextCronRun } from "@/lib/operate/cron-next-run";

import { loadClosureCountsWithTimeout } from "./load-closure-counts";
import {
  computeClosureScorecard,
  describeClosureScorecard,
  type ClosureCounts,
  type ClosureScorecard,
  type PriorRun,
  type StockChanges,
} from "./measures";

export const CLOSURE_SCORECARD_ARTIFACT_KIND = "closure-scorecard";
const WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;

export type ClosureScorecardArtifact = {
  periodKey: string;
  window: { since: string; until: string };
  counts: ClosureCounts;
  /** Net change in each stock since the prior snapshot (not event counts). */
  changes: StockChanges;
  priorPeriodKey: string;
  priorFound: boolean;
  scorecard: ClosureScorecard;
};

export type RecordedRun = { taskRunId: string; artifact: ClosureScorecardArtifact | null };

export interface ClosureScorecardStore {
  /** The run recorded under this day key, with its artifact if one exists. */
  findRun(taskRunId: string): Promise<RecordedRun | null>;
  loadCounts(window: { since: Date; until: Date }): Promise<ClosureCounts>;
  /** Write run and artifact atomically; "conflict" when the day key already exists. */
  createRun(input: RunWrite): Promise<"created" | "conflict">;
  /**
   * Attach the artifact to a run recorded without one, under a row lock on the
   * run so two retries cannot both attach; "exists" when another got there first.
   */
  addArtifact(taskRunId: string, artifact: ClosureScorecardArtifact, summary: string): Promise<"added" | "exists">;
}

export type RunWrite = {
  taskRunId: string;
  ownerUserId: string;
  agentId: string;
  taskId: string;
  periodKey: string;
  summary: string;
  artifact: ClosureScorecardArtifact;
  completedAt: Date;
};

/** UTC calendar day. */
export function closureScorecardPeriodKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The unique per-day TaskRun key. */
export function closureScorecardRunId(periodKey: string): string {
  return `TR-CSC-${periodKey.replaceAll("-", "")}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read an artifact back; anything malformed counts as missing. */
export function artifactFromParts(parts: unknown): ClosureScorecardArtifact | null {
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (!isObject(part) || part.type !== CLOSURE_SCORECARD_ARTIFACT_KIND || !isObject(part.data)) continue;
    const data = part.data;
    const counts = data.counts;
    if (!isObject(counts) || !isObject(counts.snapshot) || !isObject(counts.window)) continue;
    const snapshot = counts.snapshot;
    if (!["builds", "signals", "proposals", "backlog", "selfFiled", "acceptance", "escalations"].every((k) => isObject(snapshot[k]))) continue;
    return data as unknown as ClosureScorecardArtifact;
  }
  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return isObject(error) && error.code === "P2002";
}

function artifactParts(artifact: ClosureScorecardArtifact): Prisma.InputJsonValue {
  // Widen through `unknown`: counts carry `null` ages, which Prisma's
  // InputJsonValue type excludes although null is valid JSON.
  return [{ type: CLOSURE_SCORECARD_ARTIFACT_KIND, mimeType: "application/json", data: artifact }] as unknown as Prisma.InputJsonValue;
}

export const prismaClosureScorecardStore: ClosureScorecardStore = {
  async findRun(taskRunId) {
    const run = await prisma.taskRun.findUnique({ where: { taskRunId }, select: { id: true, taskRunId: true } });
    if (!run) return null;
    const rows = await prisma.taskArtifact.findMany({ where: { taskRunId: run.id }, select: { parts: true } });
    const artifact = rows.map((row) => artifactFromParts(row.parts)).find((a) => a !== null) ?? null;
    return { taskRunId: run.taskRunId, artifact };
  },

  loadCounts: (window) => loadClosureCountsWithTimeout(window),

  async createRun(input) {
    try {
      await prisma.$transaction(async (tx) => {
        const run = await tx.taskRun.create({
          data: {
            taskRunId: input.taskRunId,
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
            repeatedPatternKey: `closure-scorecard:${input.periodKey}`,
            progressPayload: { summary: input.summary } as Prisma.InputJsonValue,
            completedAt: input.completedAt,
          },
          select: { id: true },
        });
        await tx.taskArtifact.create({
          data: {
            id: randomUUID(),
            artifactId: `ta_${randomUUID()}`,
            taskRunId: run.id,
            name: "Closure scorecard",
            description: input.summary,
            parts: artifactParts(input.artifact),
            metadata: { kind: CLOSURE_SCORECARD_ARTIFACT_KIND, periodKey: input.periodKey },
          },
        });
      });
      return "created";
    } catch (error) {
      if (isUniqueViolation(error)) return "conflict";
      throw error;
    }
  },

  async addArtifact(taskRunId, artifact, summary) {
    return prisma.$transaction(async (tx) => {
      // Serialise repairers on the run row, then re-check under the lock.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "TaskRun" WHERE "taskRunId" = ${taskRunId} FOR UPDATE`;
      const runId = locked[0]?.id;
      if (!runId) throw new Error(`closure scorecard run ${taskRunId} disappeared before repair`);
      const existing = await tx.taskArtifact.findMany({ where: { taskRunId: runId }, select: { parts: true } });
      if (existing.some((row) => artifactFromParts(row.parts) !== null)) return "exists" as const;
      await tx.taskArtifact.create({
        data: {
          id: randomUUID(),
          artifactId: `ta_${randomUUID()}`,
          taskRunId: runId,
          name: "Closure scorecard",
          description: summary,
          parts: artifactParts(artifact),
          metadata: { kind: CLOSURE_SCORECARD_ARTIFACT_KIND, periodKey: artifact.periodKey, repaired: true },
        },
      });
      return "added" as const;
    });
  },
};

export type ClosureScorecardRunResult =
  | { outcome: "idempotent"; periodKey: string; taskRunId: string }
  | { outcome: "created" | "repaired"; periodKey: string; taskRunId: string; summary: string; artifact: ClosureScorecardArtifact };

export async function runClosureScorecard(
  store: ClosureScorecardStore,
  input: { ownerUserId: string; agentId: string; taskId: string; now: Date },
): Promise<ClosureScorecardRunResult> {
  const periodKey = closureScorecardPeriodKey(input.now);
  const taskRunId = closureScorecardRunId(periodKey);
  const existing = await store.findRun(taskRunId);
  if (existing?.artifact) return { outcome: "idempotent", periodKey, taskRunId };

  const until = input.now;
  const since = new Date(until.getTime() - WINDOW_DAYS * MS_PER_DAY);
  const priorPeriodKey = closureScorecardPeriodKey(since);
  const [counts, priorRun] = await Promise.all([
    store.loadCounts({ since, until }),
    store.findRun(closureScorecardRunId(priorPeriodKey)),
  ]);
  const prior: PriorRun | null = priorRun?.artifact
    ? { counts: priorRun.artifact.counts, changes: priorRun.artifact.changes ?? null }
    : null;
  const scorecard = computeClosureScorecard(counts, prior);
  const summary = describeClosureScorecard(scorecard);
  const artifact: ClosureScorecardArtifact = {
    periodKey,
    window: { since: since.toISOString(), until: until.toISOString() },
    counts,
    changes: scorecard.changes,
    priorPeriodKey,
    priorFound: prior !== null,
    scorecard,
  };

  if (existing) {
    const added = await store.addArtifact(taskRunId, artifact, summary);
    return added === "added"
      ? { outcome: "repaired", periodKey, taskRunId, summary, artifact }
      : { outcome: "idempotent", periodKey, taskRunId };
  }
  const written = await store.createRun({
    taskRunId, ownerUserId: input.ownerUserId, agentId: input.agentId, taskId: input.taskId,
    periodKey, summary, artifact, completedAt: new Date(),
  });
  if (written === "created") return { outcome: "created", periodKey, taskRunId, summary, artifact };

  // Another writer took the day key first: repair its run if it has no artifact yet.
  const winner = await store.findRun(taskRunId);
  if (winner?.artifact) return { outcome: "idempotent", periodKey, taskRunId };
  const added = await store.addArtifact(taskRunId, artifact, summary);
  return added === "added"
    ? { outcome: "repaired", periodKey, taskRunId, summary, artifact }
    : { outcome: "idempotent", periodKey, taskRunId };
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
    const summary = result.outcome === "idempotent"
      ? `already recorded for ${result.periodKey} (${result.taskRunId})`
      : `${result.outcome === "repaired" ? "repaired missing artifact: " : ""}${result.summary}`;
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
