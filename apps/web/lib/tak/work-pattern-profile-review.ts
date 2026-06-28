import { randomUUID } from "node:crypto";
import type { Prisma } from "@dpf/db";
import type { SubmitCoworkerSelfAssessmentInput } from "@/lib/coworker-self-assessment/types";
import {
  classifyPatternSignals,
  type PatternObserverEnvelope,
  type PatternObserverTaskRun,
  type PatternObserverToolExecution,
  type PatternObserverTurnMetric,
} from "./pattern-observer";

export const WORK_PATTERN_PROFILE_REVIEW_WINDOW_DAYS = 7;
export const WORK_PATTERN_PROFILE_REVIEW_MIN_COMPLETED_RUNS = 10;

export type WorkPatternReviewTarget = {
  agentId: string;
  routeContext?: string | null;
};

export type WorkPatternProfileReviewTaskRunData = {
  taskRunId?: string;
  userId: string;
  initiatingAgentId: string;
  currentAgentId: string;
  routeContext: string | null;
  title: string;
  objective: string;
  source: "proactive";
  status: "working";
  a2aMetadata: Record<string, unknown>;
};

export type WorkPatternProfileReviewQuery = {
  agentId: string;
  routeContext?: string | null;
  now: Date;
  windowStart: Date;
  windowDays: number;
  minCompletedRuns: number;
};

export type WorkPatternProfileReviewDb = {
  createTaskRun(data: WorkPatternProfileReviewTaskRunData): Promise<{ taskRunId: string }>;
  completeTaskRun(
    taskRunId: string,
    data: { status: "completed"; completedAt: Date; progressPayload: Record<string, unknown> },
  ): Promise<unknown>;
  listToolExecutions(query: WorkPatternProfileReviewQuery): Promise<PatternObserverToolExecution[]>;
  listTurnMetrics(query: WorkPatternProfileReviewQuery): Promise<PatternObserverTurnMetric[]>;
  listTaskRuns(query: WorkPatternProfileReviewQuery): Promise<PatternObserverTaskRun[]>;
  listEnvelopes(query: WorkPatternProfileReviewQuery): Promise<PatternObserverEnvelope[]>;
  listPriorNeeds(query: WorkPatternProfileReviewQuery): Promise<Array<{ evidenceJson?: unknown; readinessJson?: unknown }>>;
  listDueReviewTargets(query: {
    now: Date;
    windowStart: Date;
    windowDays: number;
    minCompletedRuns: number;
  }): Promise<WorkPatternReviewTarget[]>;
};

export type WorkPatternProfileReviewDeps = {
  db?: WorkPatternProfileReviewDb;
  resolveOwnerUserId?: () => Promise<string>;
  submitSelfAssessment?: (input: SubmitCoworkerSelfAssessmentInput) => Promise<unknown>;
  now?: () => Date;
};

export type WorkPatternProfileReviewResult = {
  taskRunId: string;
  observedPatterns: number;
  needsFiled: number;
};

function createPublicTaskRunId(): string {
  return `TR-SCHED-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function windowStart(now: Date): Date {
  return new Date(now.getTime() - WORK_PATTERN_PROFILE_REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fingerprintFromNeed(row: { evidenceJson?: unknown; readinessJson?: unknown }): string | null {
  for (const value of [row.evidenceJson, row.readinessJson]) {
    if (!isRecord(value)) continue;
    const fingerprint = value.fingerprint;
    if (typeof fingerprint === "string" && fingerprint.length > 0) return fingerprint;
  }
  return null;
}

function targetKey(target: WorkPatternReviewTarget): string {
  return `${target.agentId}|${target.routeContext ?? ""}`;
}

async function defaultDb(): Promise<WorkPatternProfileReviewDb> {
  const { prisma } = await import("@dpf/db");
  return {
    createTaskRun: async (data) => {
      const row = await prisma.taskRun.create({
        data: {
          taskRunId: data.taskRunId ?? createPublicTaskRunId(),
          userId: data.userId,
          initiatingAgentId: data.initiatingAgentId,
          currentAgentId: data.currentAgentId,
          routeContext: data.routeContext,
          title: data.title,
          objective: data.objective,
          source: data.source,
          status: data.status,
          a2aMetadata: data.a2aMetadata as Prisma.InputJsonValue,
        },
        select: { taskRunId: true },
      });
      return row;
    },
    completeTaskRun: (taskRunId, data) =>
      prisma.taskRun.update({
        where: { taskRunId },
        data: {
          status: data.status,
          completedAt: data.completedAt,
          progressPayload: data.progressPayload as Prisma.InputJsonValue,
        },
      }),
    listToolExecutions: (query) =>
      prisma.toolExecution.findMany({
        where: {
          agentId: query.agentId,
          ...(query.routeContext ? { routeContext: query.routeContext } : {}),
          createdAt: { gte: query.windowStart },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          toolName: true,
          success: true,
          summary: true,
          result: true,
          taskRunId: true,
          createdAt: true,
        },
      }),
    listTurnMetrics: (query) =>
      prisma.coworkerTurnMetric.findMany({
        where: {
          agentId: query.agentId,
          ...(query.routeContext ? { routeContext: query.routeContext } : {}),
          createdAt: { gte: query.windowStart },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    listTaskRuns: (query) =>
      prisma.taskRun.findMany({
        where: {
          currentAgentId: query.agentId,
          ...(query.routeContext ? { routeContext: query.routeContext } : {}),
          createdAt: { gte: query.windowStart },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          taskRunId: true,
          repeatedPatternKey: true,
          a2aMetadata: true,
          createdAt: true,
        },
      }),
    listEnvelopes: (query) =>
      prisma.coworkerActionEnvelope
        .findMany({
          where: {
            coworkerAgentId: query.agentId,
            createdAt: { gte: query.windowStart },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true,
            manifestActionId: true,
            status: true,
            createdAt: true,
          },
        })
        .then((rows) =>
          rows.map((row) => ({
            id: row.id,
            proposedActionKey: row.manifestActionId,
            status: row.status,
            approved: row.status === "approved",
            createdAt: row.createdAt,
          })),
        ),
    listPriorNeeds: (query) =>
      prisma.coworkerCapabilityNeed.findMany({
        where: {
          agentId: query.agentId,
          createdAt: { gte: query.windowStart },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { evidenceJson: true, readinessJson: true },
      }),
    listDueReviewTargets: async (query) => {
      const [completed, recentReviews] = await Promise.all([
        prisma.taskRun.findMany({
          where: {
            status: "completed",
            currentAgentId: { not: null },
            createdAt: { gte: query.windowStart },
          },
          select: { currentAgentId: true, routeContext: true },
          take: 500,
        }),
        prisma.taskRun.findMany({
          where: {
            source: "proactive",
            title: { startsWith: "Work pattern profile review:" },
            createdAt: { gte: query.windowStart },
          },
          select: { currentAgentId: true, routeContext: true },
          take: 500,
        }),
      ]);
      const reviewed = new Set(
        recentReviews
          .filter((row) => row.currentAgentId)
          .map((row) => targetKey({ agentId: row.currentAgentId!, routeContext: row.routeContext })),
      );
      const counts = new Map<string, { target: WorkPatternReviewTarget; count: number }>();
      for (const row of completed) {
        if (!row.currentAgentId) continue;
        const target = { agentId: row.currentAgentId, routeContext: row.routeContext };
        const key = targetKey(target);
        const current = counts.get(key) ?? { target, count: 0 };
        current.count += 1;
        counts.set(key, current);
      }
      return Array.from(counts.values())
        .filter((entry) => entry.count >= 1 && !reviewed.has(targetKey(entry.target)))
        .filter((entry) => entry.count >= query.minCompletedRuns || entry.count > 0)
        .map((entry) => entry.target)
        .slice(0, 10);
    },
  };
}

async function defaultOwner(): Promise<string> {
  const { resolveScheduledOwnerUserId } = await import("@/lib/queue/scheduled-owner");
  return resolveScheduledOwnerUserId();
}

async function defaultSubmitSelfAssessment(input: SubmitCoworkerSelfAssessmentInput) {
  const { submitCoworkerSelfAssessment } = await import(
    "@/lib/coworker-self-assessment/assessment-service"
  );
  return submitCoworkerSelfAssessment(input);
}

export async function runWorkPatternProfileReview(
  input: { agentId: string; routeContext?: string | null; now?: Date },
  deps?: WorkPatternProfileReviewDeps,
): Promise<WorkPatternProfileReviewResult> {
  const db = deps?.db ?? (await defaultDb());
  const now = input.now ?? deps?.now?.() ?? new Date();
  const since = windowStart(now);
  const routeContext = input.routeContext ?? null;
  const ownerId = await (deps?.resolveOwnerUserId ?? defaultOwner)();
  const review = await db.createTaskRun({
    userId: ownerId,
    initiatingAgentId: input.agentId,
    currentAgentId: input.agentId,
    routeContext,
    title: `Work pattern profile review: ${input.agentId}`,
    objective: `Review recent work-pattern evidence for ${input.agentId}.`,
    source: "proactive",
    status: "working",
    a2aMetadata: {
      trigger: "scheduled",
      profileReview: {
        type: "work-pattern-profile-review",
        agentId: input.agentId,
        routeContext,
        windowDays: WORK_PATTERN_PROFILE_REVIEW_WINDOW_DAYS,
      },
    },
  });

  const query: WorkPatternProfileReviewQuery = {
    agentId: input.agentId,
    routeContext,
    now,
    windowStart: since,
    windowDays: WORK_PATTERN_PROFILE_REVIEW_WINDOW_DAYS,
    minCompletedRuns: WORK_PATTERN_PROFILE_REVIEW_MIN_COMPLETED_RUNS,
  };
  const [toolExecutions, turnMetrics, taskRuns, envelopes, priorNeeds] = await Promise.all([
    db.listToolExecutions(query),
    db.listTurnMetrics(query),
    db.listTaskRuns(query),
    db.listEnvelopes(query),
    db.listPriorNeeds(query),
  ]);
  const priorNeedFingerprints = new Set(
    priorNeeds.map(fingerprintFromNeed).filter((value): value is string => Boolean(value)),
  );
  const classified = classifyPatternSignals({
    agentId: input.agentId,
    routeContext,
    since,
    toolExecutions,
    turnMetrics,
    taskRuns,
    envelopes,
    priorNeedFingerprints,
  });

  if (classified.needs.length > 0) {
    const submit = deps?.submitSelfAssessment ?? defaultSubmitSelfAssessment;
    await submit({
      agentId: input.agentId,
      trigger: "work-pattern-profile-review",
      routeContext,
      verdict: "gaps",
      confidence: "medium",
      missionSummary: `Reviewed ${WORK_PATTERN_PROFILE_REVIEW_WINDOW_DAYS} days of work-pattern evidence.`,
      capabilitySummary: classified.needs.map((need) => need.need).join("; "),
      rawPayload: {
        taskRunId: review.taskRunId,
        patternKeys: classified.patterns.map((pattern) => pattern.metadata.patternKey),
      },
      needs: classified.needs.map((need) => ({
        kind: need.kind,
        severity: need.severity,
        need: need.need,
        blocks: need.blocks,
        evidenceJson: need.evidenceJson,
        readinessJson: need.readinessJson,
      })),
    });
  }

  const progressPayload = {
    type: "work-pattern-profile-review",
    agentId: input.agentId,
    routeContext,
    windowDays: WORK_PATTERN_PROFILE_REVIEW_WINDOW_DAYS,
    observedPatterns: classified.patterns.length,
    needsFiled: classified.needs.length,
  };
  await db.completeTaskRun(review.taskRunId, {
    status: "completed",
    completedAt: now,
    progressPayload,
  });

  return {
    taskRunId: review.taskRunId,
    observedPatterns: classified.patterns.length,
    needsFiled: classified.needs.length,
  };
}

export async function runDueWorkPatternProfileReviews(
  deps?: WorkPatternProfileReviewDeps,
): Promise<{ reviewed: number; results: WorkPatternProfileReviewResult[] }> {
  const db = deps?.db ?? (await defaultDb());
  const now = deps?.now?.() ?? new Date();
  const targets = await db.listDueReviewTargets({
    now,
    windowStart: windowStart(now),
    windowDays: WORK_PATTERN_PROFILE_REVIEW_WINDOW_DAYS,
    minCompletedRuns: WORK_PATTERN_PROFILE_REVIEW_MIN_COMPLETED_RUNS,
  });
  const results: WorkPatternProfileReviewResult[] = [];
  for (const target of targets) {
    results.push(await runWorkPatternProfileReview({ ...target, now }, { ...deps, db }));
  }
  return { reviewed: results.length, results };
}
