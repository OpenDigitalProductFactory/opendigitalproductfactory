import { randomUUID } from "node:crypto";

import type { Prisma } from "@dpf/db";
import { prisma } from "@dpf/db";

import { resolveScheduledOwnerUserId } from "@/lib/queue/scheduled-owner";

import { isReflectionLoopGuarded, type ReflectionDepthSource } from "./core";
import { observeCoworkerPatterns } from "./observer";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export const PERIODIC_PATTERN_REVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const PERIODIC_PATTERN_REVIEW_MIN_COMPLETED_RUNS = 10;

export type PeriodicPatternReviewWindow = {
  agentId: string;
  routeContext: string | null;
  since: Date;
  until: Date;
};

export type PeriodicPatternReviewTaskRunData = {
  taskRunId?: string;
  userId: string;
  initiatingAgentId: string;
  currentAgentId: string;
  parentTaskRunId?: string | null;
  routeContext: string | null;
  title: string;
  objective: string;
  source: "proactive";
  status: "working";
  a2aMetadata: Record<string, unknown>;
};

export type PeriodicPatternReviewDb = {
  getTaskRun(taskRunId: string): Promise<ReflectionDepthSource | null>;
  countCompletedRuns(input: PeriodicPatternReviewWindow): Promise<number>;
  findRecentReview(input: PeriodicPatternReviewWindow): Promise<{ taskRunId: string } | null>;
  createTaskRun(data: PeriodicPatternReviewTaskRunData): Promise<{ taskRunId: string }>;
  completeTaskRun(
    taskRunId: string,
    data: {
      status: "completed" | "failed";
      completedAt: Date;
      progressPayload: Record<string, unknown>;
    },
  ): Promise<unknown>;
};

export type PeriodicPatternReviewInput = {
  agentId: string;
  routeContext?: string | null;
  parentTaskRunId?: string | null;
};

export type PeriodicPatternReviewResult =
  | {
      reviewed: true;
      taskRunId: string;
      observedNeeds: number;
    }
  | {
      reviewed: false;
      skippedReason: "reflection-loop-guard" | "recently-reviewed" | "below-run-count";
    };

export type PeriodicPatternReviewDeps = {
  db: PeriodicPatternReviewDb;
  resolveOwnerUserId: () => Promise<string>;
  observeCoworkerPatterns: typeof observeCoworkerPatterns;
  now: () => Date;
  createTaskRunId: () => string;
};

function createReviewTaskRunId(): string {
  return `TR-GAP-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function defaultDb(): PeriodicPatternReviewDb {
  return {
    getTaskRun: (taskRunId) =>
      prisma.taskRun.findUnique({
        where: { taskRunId },
        select: { source: true, title: true, a2aMetadata: true },
      }),
    countCompletedRuns: (input) =>
      prisma.taskRun.count({
        where: {
          OR: [{ currentAgentId: input.agentId }, { initiatingAgentId: input.agentId }],
          routeContext: input.routeContext,
          status: "completed",
          completedAt: { gte: input.since, lte: input.until },
        },
      }),
    findRecentReview: (input) =>
      prisma.taskRun.findFirst({
        where: {
          currentAgentId: input.agentId,
          routeContext: input.routeContext,
          source: "proactive",
          title: `Periodic pattern review: ${input.agentId}`,
          createdAt: { gte: input.since, lte: input.until },
        },
        orderBy: { createdAt: "desc" },
        select: { taskRunId: true },
      }),
    createTaskRun: (data) =>
      prisma.taskRun.create({
        data: {
          taskRunId: data.taskRunId ?? createReviewTaskRunId(),
          userId: data.userId,
          initiatingAgentId: data.initiatingAgentId,
          currentAgentId: data.currentAgentId,
          parentTaskRunId: data.parentTaskRunId ?? null,
          routeContext: data.routeContext,
          title: data.title,
          objective: data.objective,
          source: data.source,
          status: data.status,
          authorityScope: [],
          a2aMetadata: data.a2aMetadata as Prisma.InputJsonValue,
        },
        select: { taskRunId: true },
      }),
    completeTaskRun: (taskRunId, data) =>
      prisma.taskRun.update({
        where: { taskRunId },
        data: {
          status: data.status,
          completedAt: data.completedAt,
          progressPayload: data.progressPayload as Prisma.InputJsonValue,
        },
      }),
  };
}

function resolveDeps(deps?: Partial<PeriodicPatternReviewDeps>): PeriodicPatternReviewDeps {
  return {
    db: deps?.db ?? defaultDb(),
    resolveOwnerUserId: deps?.resolveOwnerUserId ?? resolveScheduledOwnerUserId,
    observeCoworkerPatterns: deps?.observeCoworkerPatterns ?? observeCoworkerPatterns,
    now: deps?.now ?? (() => new Date()),
    createTaskRunId: deps?.createTaskRunId ?? createReviewTaskRunId,
  };
}

function reviewWindow(input: PeriodicPatternReviewInput, now: Date): PeriodicPatternReviewWindow {
  return {
    agentId: input.agentId,
    routeContext: input.routeContext ?? null,
    since: new Date(now.getTime() - PERIODIC_PATTERN_REVIEW_WINDOW_MS),
    until: now,
  };
}

export async function runPeriodicPatternReview(
  input: PeriodicPatternReviewInput,
  deps?: Partial<PeriodicPatternReviewDeps>,
): Promise<PeriodicPatternReviewResult> {
  const resolved = resolveDeps(deps);
  const now = resolved.now();
  const window = reviewWindow(input, now);

  if (input.parentTaskRunId) {
    const parent = await resolved.db.getTaskRun(input.parentTaskRunId);
    if (isReflectionLoopGuarded(parent)) {
      return { reviewed: false, skippedReason: "reflection-loop-guard" };
    }
  }

  const recentReview = await resolved.db.findRecentReview(window);
  if (recentReview) {
    return { reviewed: false, skippedReason: "recently-reviewed" };
  }

  const completedRuns = await resolved.db.countCompletedRuns(window);
  if (completedRuns < PERIODIC_PATTERN_REVIEW_MIN_COMPLETED_RUNS) {
    return { reviewed: false, skippedReason: "below-run-count" };
  }

  const ownerUserId = await resolved.resolveOwnerUserId();
  const review = await resolved.db.createTaskRun({
    taskRunId: resolved.createTaskRunId(),
    userId: ownerUserId,
    initiatingAgentId: input.agentId,
    currentAgentId: input.agentId,
    parentTaskRunId: input.parentTaskRunId ?? null,
    routeContext: window.routeContext,
    title: `Periodic pattern review: ${input.agentId}`,
    objective: `Review recent systemic coworker pattern evidence for ${input.agentId}.`,
    source: "proactive",
    status: "working",
    a2aMetadata: {
      trigger: "periodic-pattern-review",
      reflectionDepth: 0,
      windowDays: PERIODIC_PATTERN_REVIEW_WINDOW_MS / (24 * 60 * 60 * 1000),
      minCompletedRuns: PERIODIC_PATTERN_REVIEW_MIN_COMPLETED_RUNS,
    },
  });

  try {
    const observed = await resolved.observeCoworkerPatterns({
      agentId: input.agentId,
      routeContext: window.routeContext,
      since: window.since,
      until: window.until,
      windowMs: PERIODIC_PATTERN_REVIEW_WINDOW_MS,
    });
    await resolved.db.completeTaskRun(review.taskRunId, {
      status: "completed",
      completedAt: now,
      progressPayload: {
        type: "periodic-pattern-review",
        agentId: input.agentId,
        routeContext: window.routeContext,
        completedRuns,
        observedNeeds: observed.processed,
        submitted: observed.submitted,
      },
    });
    return {
      reviewed: true,
      taskRunId: review.taskRunId,
      observedNeeds: observed.processed,
    };
  } catch (err) {
    await resolved.db.completeTaskRun(review.taskRunId, {
      status: "failed",
      completedAt: now,
      progressPayload: {
        type: "periodic-pattern-review",
        agentId: input.agentId,
        routeContext: window.routeContext,
        error: getErrorMessage(err),
      },
    });
    throw err;
  }
}
