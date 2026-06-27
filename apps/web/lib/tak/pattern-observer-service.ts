import type { Prisma } from "@dpf/db";
import type { SubmitCoworkerSelfAssessmentInput } from "@/lib/coworker-self-assessment/types";
import type { CreateOrTouchImprovementSignalInput } from "@/lib/improvement-flywheel/signals";
import { getReflectionDepth, isReflectionRun } from "./reflection-triggers";
import {
  classifyPatternSignals,
  type PatternObserverEnvelope,
  type PatternObserverTaskRun,
  type PatternObserverToolExecution,
  type PatternObserverTurnMetric,
} from "./pattern-observer";
import { mergeWorkPatternMetadata } from "./work-pattern-types";

const OBSERVER_WINDOW_MS = 24 * 60 * 60 * 1000;

export type PatternObserverParentRun = {
  taskRunId: string;
  source?: string | null;
  title?: string | null;
  a2aMetadata?: Prisma.JsonValue | null;
};

export type PatternObserverNeedRow = {
  evidenceJson?: unknown;
  readinessJson?: unknown;
};

export type PatternObserverQueryInput = {
  taskRunId: string;
  agentId: string;
  routeContext: string;
  threadId: string | null;
  since: Date;
  windowStart: Date;
};

export type PatternObserverServiceDb = {
  getTaskRun(taskRunId: string): Promise<PatternObserverParentRun | null>;
  updateTaskRun(
    taskRunId: string,
    data: { repeatedPatternKey: string; a2aMetadata: Record<string, unknown> },
  ): Promise<unknown>;
  listToolExecutions(input: PatternObserverQueryInput): Promise<PatternObserverToolExecution[]>;
  listTurnMetrics(input: PatternObserverQueryInput): Promise<PatternObserverTurnMetric[]>;
  listTaskRuns(input: PatternObserverQueryInput): Promise<PatternObserverTaskRun[]>;
  listEnvelopes(input: PatternObserverQueryInput): Promise<PatternObserverEnvelope[]>;
  listPriorNeeds(input: PatternObserverQueryInput): Promise<PatternObserverNeedRow[]>;
};

export type PatternObserverServiceDeps = {
  db?: PatternObserverServiceDb;
  submitSelfAssessment?: (input: SubmitCoworkerSelfAssessmentInput) => Promise<unknown>;
  touchImprovementSignal?: (input: CreateOrTouchImprovementSignalInput) => Promise<unknown>;
};

export type ObserveWorkPatternsAfterRunInput = {
  taskRunId: string | null;
  userId: string;
  agentId: string;
  threadId: string | null;
  routeContext: string;
  since: Date;
};

export type ObserveWorkPatternsAfterRunResult = {
  processed: number;
  skippedReason?:
    | "missing-task-run"
    | "reflection-loop-guard"
    | "no-signals"
    | "observer-error";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fingerprintFromNeed(row: PatternObserverNeedRow): string | null {
  for (const value of [row.evidenceJson, row.readinessJson]) {
    if (!isRecord(value)) continue;
    const fingerprint = value.fingerprint;
    if (typeof fingerprint === "string" && fingerprint.length > 0) {
      return fingerprint;
    }
  }
  return null;
}

async function defaultDb(): Promise<PatternObserverServiceDb> {
  const { prisma } = await import("@dpf/db");
  return {
    getTaskRun: (taskRunId) =>
      prisma.taskRun.findUnique({
        where: { taskRunId },
        select: { taskRunId: true, source: true, title: true, a2aMetadata: true },
      }),
    updateTaskRun: (taskRunId, data) =>
      prisma.taskRun.update({
        where: { taskRunId },
        data: {
          repeatedPatternKey: data.repeatedPatternKey,
          a2aMetadata: data.a2aMetadata as Prisma.InputJsonValue,
        },
      }),
    listToolExecutions: (input) =>
      prisma.toolExecution.findMany({
        where: {
          OR: [
            { taskRunId: input.taskRunId },
            {
              agentId: input.agentId,
              routeContext: input.routeContext,
              createdAt: { gte: input.windowStart },
            },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 50,
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
    listTurnMetrics: (input) =>
      prisma.coworkerTurnMetric.findMany({
        where: input.threadId
          ? {
              OR: [
                { threadId: input.threadId },
                {
                  agentId: input.agentId,
                  routeContext: input.routeContext,
                  createdAt: { gte: input.windowStart },
                },
              ],
            }
          : {
              agentId: input.agentId,
              routeContext: input.routeContext,
              createdAt: { gte: input.windowStart },
            },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    listTaskRuns: (input) =>
      prisma.taskRun.findMany({
        where: {
          currentAgentId: input.agentId,
          routeContext: input.routeContext,
          createdAt: { gte: input.windowStart },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          taskRunId: true,
          repeatedPatternKey: true,
          a2aMetadata: true,
          createdAt: true,
        },
      }),
    listEnvelopes: (input) =>
      prisma.coworkerActionEnvelope
        .findMany({
          where: input.threadId
            ? {
                OR: [
                  { threadId: input.threadId },
                  {
                    coworkerAgentId: input.agentId,
                    createdAt: { gte: input.windowStart },
                  },
                ],
              }
            : {
                coworkerAgentId: input.agentId,
                createdAt: { gte: input.windowStart },
              },
          orderBy: { createdAt: "desc" },
          take: 50,
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
    listPriorNeeds: (input) =>
      prisma.coworkerCapabilityNeed.findMany({
        where: {
          agentId: input.agentId,
          createdAt: { gte: input.windowStart },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { evidenceJson: true, readinessJson: true },
      }),
  };
}

async function defaultSubmitSelfAssessment(input: SubmitCoworkerSelfAssessmentInput) {
  const { submitCoworkerSelfAssessment } = await import(
    "@/lib/coworker-self-assessment/assessment-service"
  );
  return submitCoworkerSelfAssessment(input);
}

async function defaultTouchImprovementSignal(input: CreateOrTouchImprovementSignalInput) {
  const { createOrTouchImprovementSignal } = await import(
    "@/lib/improvement-flywheel/signals"
  );
  return createOrTouchImprovementSignal(input);
}

export async function observeWorkPatternsAfterRun(
  input: ObserveWorkPatternsAfterRunInput,
  deps?: PatternObserverServiceDeps,
): Promise<ObserveWorkPatternsAfterRunResult> {
  if (!input.taskRunId) {
    return { processed: 0, skippedReason: "missing-task-run" };
  }

  try {
    const db = deps?.db ?? (await defaultDb());
    const parent = await db.getTaskRun(input.taskRunId);
    if (!parent) {
      return { processed: 0, skippedReason: "missing-task-run" };
    }
    if (isReflectionRun(parent) || getReflectionDepth(parent) >= 1) {
      return { processed: 0, skippedReason: "reflection-loop-guard" };
    }

    const windowStart = new Date(input.since.getTime() - OBSERVER_WINDOW_MS);
    const query: PatternObserverQueryInput = {
      taskRunId: input.taskRunId,
      agentId: input.agentId,
      routeContext: input.routeContext,
      threadId: input.threadId,
      since: input.since,
      windowStart,
    };
    const [toolExecutions, turnMetrics, taskRuns, envelopes, priorNeeds] =
      await Promise.all([
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
      routeContext: input.routeContext,
      since: input.since,
      toolExecutions,
      turnMetrics,
      taskRuns,
      envelopes,
      priorNeedFingerprints,
    });
    if (classified.needs.length === 0 || classified.patterns.length === 0) {
      return { processed: 0, skippedReason: "no-signals" };
    }

    const firstPattern = classified.patterns[0];
    await db.updateTaskRun(input.taskRunId, {
      repeatedPatternKey: firstPattern.metadata.patternKey,
      a2aMetadata: mergeWorkPatternMetadata(parent.a2aMetadata, firstPattern.metadata),
    });

    const submitSelfAssessment = deps?.submitSelfAssessment ?? defaultSubmitSelfAssessment;
    await submitSelfAssessment({
      agentId: input.agentId,
      trigger: "work-pattern-observer",
      routeContext: input.routeContext,
      verdict: "gaps",
      confidence: "medium",
      missionSummary: `Observed ${classified.needs.length} repeated work-pattern signal(s).`,
      capabilitySummary: classified.needs.map((need) => need.need).join("; "),
      rawPayload: {
        taskRunId: input.taskRunId,
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

    const touchImprovementSignal =
      deps?.touchImprovementSignal ?? defaultTouchImprovementSignal;
    for (const pattern of classified.patterns) {
      await touchImprovementSignal({
        sourceType: "work_pattern_observer",
        sourceId: pattern.metadata.patternKey,
        title: pattern.need.need,
        description: pattern.need.blocks,
        evidence: pattern.need.evidenceJson,
        routeContext: input.routeContext,
        agentId: input.agentId,
        threadId: input.threadId,
        suspectedRootCause: String(pattern.need.evidenceJson.signal ?? "work-pattern"),
        objectiveImpactHypothesis:
          "Repeated coworker friction may indicate a reusable capability, convention, or tool-surface improvement.",
      });
    }

    return { processed: classified.needs.length };
  } catch (err) {
    console.warn(
      "[pattern-observer] failed to observe post-run work patterns:",
      err instanceof Error ? err.message : err,
    );
    return { processed: 0, skippedReason: "observer-error" };
  }
}
