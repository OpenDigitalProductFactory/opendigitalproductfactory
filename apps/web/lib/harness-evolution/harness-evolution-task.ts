// The deterministic executor for the daily `harness-evolution-loop` scheduled
// task (BI-49BC21C1 slice 1; spec
// docs/superpowers/specs/2026-10-28-harness-evolution-loop-design.md).
//
// A typed kind, not a prompt task: the prompt-only MCP-efficiency review
// narrates its tool call instead of making it (BI-A8679D84). This run reads
// detector output that already exists (ImprovementSignal carries the
// MCP-efficiency AI Ops and skill-curator findings), ranks it with the seed
// queue, and records the candidates with their trajectory evidence, its budget
// and its spend on one proactive TaskRun per UTC day. No model call; probes
// arrive in slice 2 and are charged against the same budget.

import { randomUUID } from "crypto";

import type { Prisma } from "@dpf/db";
import { prisma } from "@dpf/db";

import { computeNextCronRun } from "@/lib/operate/cron-next-run";

import {
  rankHarnessCandidates,
  resolveHarnessEvolutionBudget,
  resolveSeedItemIds,
  type CandidateRejection,
  type HarnessCandidate,
  type HarnessEvolutionBudget,
  type SeedItemRow,
  type SignalRow,
} from "./rank-candidates";

export const HARNESS_EVOLUTION_ARTIFACT_KIND = "harness-evolution-candidates";
/** Upper bound on signals read per run; the ranking keeps at most 25. */
const SIGNAL_READ_LIMIT = 500;

type FindArgs = { where: Record<string, unknown>; select?: Record<string, unknown>; orderBy?: unknown; take?: number };

/** The prisma surface this run touches, so tests can hand in a fake. */
export interface HarnessEvolutionDb {
  improvementSignal: { findMany(args: FindArgs): Promise<SignalRow[]> };
  backlogItem: { findMany(args: FindArgs): Promise<SeedItemRow[]> };
  taskRun: {
    findFirst(args: FindArgs): Promise<{ taskRunId: string } | null>;
    create(args: { data: Record<string, unknown>; select?: Record<string, unknown> }): Promise<{ id: string; taskRunId: string }>;
  };
  taskArtifact: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

export type HarnessEvolutionSpend = { candidatesRanked: number; probeReplays: number; tokens: number };

export type HarnessEvolutionRunResult = {
  periodKey: string;
  idempotent: boolean;
  taskRunId: string | null;
  budget: HarnessEvolutionBudget;
  spend: HarnessEvolutionSpend;
  ranked: HarnessCandidate[];
  rejected: CandidateRejection[];
  deferred: number;
};

/** UTC calendar day: one loop run per day. */
export function harnessEvolutionPeriodKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function runHarnessEvolutionLoop(
  db: HarnessEvolutionDb,
  input: { ownerUserId: string; agentId: string; taskId: string; taskConfig: unknown; now: Date },
): Promise<HarnessEvolutionRunResult> {
  const periodKey = harnessEvolutionPeriodKey(input.now);
  const repeatedPatternKey = `harness-evolution:${periodKey}`;
  const budget = resolveHarnessEvolutionBudget(input.taskConfig);
  const zeroSpend: HarnessEvolutionSpend = { candidatesRanked: 0, probeReplays: 0, tokens: 0 };

  const existing = await db.taskRun.findFirst({ where: { repeatedPatternKey }, select: { taskRunId: true } });
  if (existing) {
    return { periodKey, idempotent: true, taskRunId: existing.taskRunId, budget, spend: zeroSpend, ranked: [], rejected: [], deferred: 0 };
  }

  const since = new Date(input.now.getTime() - budget.lookbackDays * 86_400_000);
  const seedItemIds = resolveSeedItemIds(input.taskConfig);
  const [signals, seedItems] = await Promise.all([
    db.improvementSignal.findMany({
      where: { status: "open", lastSeenAt: { gte: since } },
      select: {
        signalId: true, sourceType: true, title: true, recurrenceCount: true,
        lastSeenAt: true, toolName: true, backlogItemId: true, evidence: true,
      },
      orderBy: [{ recurrenceCount: "desc" }, { lastSeenAt: "desc" }],
      take: SIGNAL_READ_LIMIT,
    }),
    seedItemIds.length
      ? db.backlogItem.findMany({ where: { itemId: { in: seedItemIds } }, select: { itemId: true, title: true, status: true } })
      : Promise.resolve([] as SeedItemRow[]),
  ]);

  const { ranked, rejected, deferred } = rankHarnessCandidates({
    now: input.now,
    maxCandidates: budget.maxCandidates,
    seedItemIds,
    seedItems,
    signals,
  });
  // Slice 1 ranks only: no editor tokens, no probe replays. Recorded as zero,
  // not omitted, so the spend line is comparable once slice 2 spends.
  const spend: HarnessEvolutionSpend = { ...zeroSpend, candidatesRanked: ranked.length };

  const taskRun = await db.taskRun.create({
    data: {
      taskRunId: `TR-HEV-${randomUUID().slice(0, 8).toUpperCase()}`,
      userId: input.ownerUserId,
      title: `Harness evolution loop ${periodKey}`,
      objective: "Rank recurring agent misses into probe candidates with trajectory evidence (propose → probe → compose → library).",
      source: "proactive",
      status: "completed",
      authorityScope: [],
      a2aMetadata: { trigger: "harness-evolution-loop", scheduledTaskId: input.taskId },
      initiatingAgentId: input.agentId,
      currentAgentId: null,
      routeContext: "/platform/ai/skills",
      repeatedPatternKey,
      progressPayload: { periodKey, budget, spend, ranked: ranked.length, rejected: rejected.length, deferred },
      completedAt: input.now,
    },
    select: { id: true, taskRunId: true },
  });

  await db.taskArtifact.create({
    data: {
      id: randomUUID(),
      artifactId: `ta_${randomUUID()}`,
      taskRunId: taskRun.id,
      name: "Harness evolution candidates",
      description: `${ranked.length} ranked, ${rejected.length} rejected, ${deferred} deferred`,
      // Widen through `unknown`: candidates carry `null` fields, which Prisma's
      // InputJsonValue type excludes although null is valid JSON.
      parts: [
        {
          type: HARNESS_EVOLUTION_ARTIFACT_KIND,
          mimeType: "application/json",
          data: { periodKey, budget, spend, ranked, rejected, deferred },
        },
      ] as unknown as Prisma.InputJsonValue,
      metadata: { kind: HARNESS_EVOLUTION_ARTIFACT_KIND, periodKey },
    },
  });

  return { periodKey, idempotent: false, taskRunId: taskRun.taskRunId, budget, spend, ranked, rejected, deferred };
}

/** One line for the schedule surface. */
export function describeHarnessEvolutionRun(result: HarnessEvolutionRunResult): string {
  if (result.idempotent) return `already recorded for ${result.periodKey} (${result.taskRunId})`;
  const noun = result.ranked.length === 1 ? "candidate" : "candidates";
  return `${result.ranked.length} ${noun} ranked; ${result.rejected.length} rejected; ${result.deferred} deferred; `
    + `spend ${result.spend.tokens} tokens, ${result.spend.probeReplays} probe replays`;
}

/** The scheduled-task fields this branch reads. */
export interface HarnessEvolutionLoopTask {
  taskId: string;
  schedule: string;
  ownerUserId: string;
  agentId: string;
  taskConfig?: unknown;
}

export async function executeHarnessEvolutionLoopTask(
  task: HarnessEvolutionLoopTask,
  deps: { now?: Date; db?: HarnessEvolutionDb } = {},
): Promise<void> {
  const startedAt = deps.now ?? new Date();
  const nextRunAt = computeNextCronRun(task.schedule, startedAt);
  try {
    const result = await runHarnessEvolutionLoop(deps.db ?? (prisma as unknown as HarnessEvolutionDb), {
      ownerUserId: task.ownerUserId,
      agentId: task.agentId,
      taskId: task.taskId,
      taskConfig: task.taskConfig,
      now: startedAt,
    });
    const summary = describeHarnessEvolutionRun(result);
    console.info("[harness-evolution-loop] %s", summary);
    await prisma.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, nextRunAt, taskRunId: result.taskRunId },
    });
    await prisma.scheduledJob
      .update({
        where: { jobId: task.taskId },
        data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, lastRunSummary: summary, nextRunAt },
      })
      .catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
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
