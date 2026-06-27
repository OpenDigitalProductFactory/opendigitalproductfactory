import { randomUUID } from "crypto";

import type { Prisma } from "@dpf/db";
import { prisma } from "@dpf/db";

import { submitCoworkerSelfAssessment } from "@/lib/coworker-self-assessment/assessment-service";
import type {
  CoworkerAssessmentConfidence,
  CoworkerAssessmentVerdict,
  CoworkerCapabilityNeedInput,
} from "@/lib/coworker-self-assessment/types";
import { createOrTouchImprovementSignal } from "@/lib/improvement-flywheel/signals";

export type ReflectionDepthSource = {
  source?: string | null;
  title?: string | null;
  a2aMetadata?: Prisma.JsonValue | null;
};

export type ObservationSpec = {
  title: string;
  trigger: string;
  verdict: CoworkerAssessmentVerdict;
  confidence: CoworkerAssessmentConfidence;
  needs: readonly CoworkerCapabilityNeedInput[];
  sourceType: string;
  sourceId: string;
  suspectedRootCause?: string | null;
};

export type RunObservationInput = {
  parentTaskRunId: string | null;
  userId: string;
  agentId: string;
  threadId: string | null;
  routeContext: string;
  sourceTitle: string;
  sourceDescription?: string | null;
  objective?: string;
  capabilitySummary?: string | null;
  rawPayload?: Record<string, unknown>;
  signalEvidence?: Record<string, unknown>;
  spec: ObservationSpec;
};

export type RunObservationResult = {
  processed: number;
  skippedReason?: "reflection-loop-guard";
};

export type ObservationDeps = {
  db: Pick<typeof prisma, "taskRun">;
  submitAssessment: typeof submitCoworkerSelfAssessment;
  touchSignal: typeof createOrTouchImprovementSignal;
  createTaskRunId: () => string;
  now: () => Date;
};

export function getReflectionDepth(parent: ReflectionDepthSource | null | undefined): number {
  if (!parent) return 0;
  const meta = parent.a2aMetadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return 0;
  const value = (meta as { reflectionDepth?: unknown }).reflectionDepth;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function isReflectionRun(parent: ReflectionDepthSource | null | undefined): boolean {
  if (!parent) return false;
  return parent.source === "proactive" && (parent.title ?? "").startsWith("Skill reflection:");
}

export function isReflectionLoopGuarded(
  parent: ReflectionDepthSource | null | undefined,
): boolean {
  return Boolean(parent && (isReflectionRun(parent) || getReflectionDepth(parent) >= 1));
}

function defaultCreateTaskRunId(): string {
  return `TR-RFL-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function resolveDeps(deps?: Partial<ObservationDeps>): ObservationDeps {
  return {
    db: deps?.db ?? prisma,
    submitAssessment: deps?.submitAssessment ?? submitCoworkerSelfAssessment,
    touchSignal: deps?.touchSignal ?? createOrTouchImprovementSignal,
    createTaskRunId: deps?.createTaskRunId ?? defaultCreateTaskRunId,
    now: deps?.now ?? (() => new Date()),
  };
}

async function readParent(
  parentTaskRunId: string | null,
  deps: ObservationDeps,
): Promise<ReflectionDepthSource | null> {
  if (!parentTaskRunId) return null;
  return deps.db.taskRun
    .findUnique({
      where: { taskRunId: parentTaskRunId },
      select: { source: true, title: true, a2aMetadata: true },
    })
    .catch(() => null);
}

function observationMetadata(input: RunObservationInput, parentDepth: number): Prisma.InputJsonValue {
  const base: Record<string, unknown> = {
    trigger: input.spec.trigger,
    sourceType: input.spec.sourceType,
    sourceId: input.spec.sourceId,
    reflectionDepth: parentDepth + 1,
  };
  if (input.spec.sourceType === "platform_issue_report") {
    base.platformIssueReportId = input.spec.sourceId;
  }
  return base as Prisma.InputJsonValue;
}

export async function runObservation(
  input: RunObservationInput,
  deps?: Partial<ObservationDeps>,
): Promise<RunObservationResult> {
  const resolved = resolveDeps(deps);
  const parent = await readParent(input.parentTaskRunId, resolved);
  if (isReflectionLoopGuarded(parent)) {
    return { processed: 0, skippedReason: "reflection-loop-guard" };
  }

  const parentDepth = getReflectionDepth(parent);
  const observationTaskRunId = resolved.createTaskRunId();
  const observationRun = await resolved.db.taskRun.create({
    data: {
      taskRunId: observationTaskRunId,
      userId: input.userId,
      threadId: input.threadId,
      contextId: input.threadId,
      initiatingAgentId: input.agentId,
      currentAgentId: input.agentId,
      parentTaskRunId: input.parentTaskRunId,
      routeContext: input.routeContext,
      title: input.spec.title,
      objective: input.objective ??
        `Observe ${input.spec.sourceType} ${input.spec.sourceId} and file durable evidence ` +
        `(self-assessment, capability need, improvement signal).`,
      source: "proactive",
      status: "working",
      authorityScope: [],
      a2aMetadata: observationMetadata(input, parentDepth),
    },
    select: { id: true, taskRunId: true },
  });

  await resolved.submitAssessment({
    agentId: input.agentId,
    trigger: input.spec.trigger,
    routeContext: input.routeContext,
    verdict: input.spec.verdict,
    confidence: input.spec.confidence,
    missionSummary: input.sourceTitle,
    capabilitySummary: input.capabilitySummary ?? null,
    rawPayload: {
      ...(input.rawPayload ?? {}),
      sourceType: input.spec.sourceType,
      sourceId: input.spec.sourceId,
      observationTaskRunId: observationRun.taskRunId,
      reflectionTaskRunId: observationRun.taskRunId,
    },
    needs: [...input.spec.needs],
  });

  await resolved.touchSignal({
    sourceType: input.spec.sourceType,
    sourceId: input.spec.sourceId,
    title: input.sourceTitle,
    description: input.sourceDescription ?? null,
    evidence: {
      ...(input.signalEvidence ?? {}),
      parentTaskRunId: input.parentTaskRunId,
      observationTaskRunId: observationRun.taskRunId,
      reflectionTaskRunId: observationRun.taskRunId,
    },
    routeContext: input.routeContext,
    agentId: input.agentId,
    threadId: input.threadId,
    suspectedRootCause: input.spec.suspectedRootCause ?? null,
  });

  await resolved.db.taskRun.update({
    where: { id: observationRun.id },
    data: { status: "completed", completedAt: resolved.now() },
  });

  return { processed: 1 };
}
