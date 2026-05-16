// Reflection trigger for the governed Hermes-style learning loop.
//
// Consumes the existing `PlatformIssueReport(type="agent_stuck")` signal
// surface and produces governed evidence: a proactive `TaskRun`, a
// `CoworkerSelfAssessment` + `CoworkerCapabilityNeed(kind="skill")`, and a
// deduped `ImprovementSignal`. Never mutates `SkillDefinition`. Reflection
// is fire-and-forget at the call site; this module is the side-effect
// boundary.
//
// Loop self-protection (three layers, all enforced here):
//
//   1. The post-run hook in autonomous-work-run is responsible for skipping
//      the call when the parent run was itself a reflection (`source ==
//      "proactive"` && title starts with "Skill reflection:"). That check
//      sits at the caller because it has the parent TaskRun in hand.
//   2. Every reflection-spawned TaskRun stamps an `a2aMetadata.reflectionDepth`
//      counter; the helper refuses to spawn a child when the originating
//      run's depth is already >= 1. Catches the case where layer 1 is
//      bypassed by a future caller that omits the source check.
//   3. ImprovementSignal dedupes on `(sourceType, sourceId)`. Calling the
//      trigger again over the same PlatformIssueReport increments
//      recurrenceCount instead of producing a parallel signal.

import { randomUUID } from "crypto";

import type { Prisma } from "@dpf/db";
import { prisma } from "@dpf/db";

import { createOrTouchImprovementSignal } from "@/lib/improvement-flywheel/signals";

const REFLECTION_TITLE = "Skill reflection: repeated tool use";

export type ReflectionDepthSource = {
  source?: string | null;
  title?: string | null;
  a2aMetadata?: Prisma.JsonValue | null;
};

/**
 * Read `a2aMetadata.reflectionDepth` off a TaskRun-shaped row. Defaults to
 * 0 when the value is missing or the metadata is not an object. Callers
 * should NEVER reach into `a2aMetadata` directly — go through this helper
 * so the shape is enforced in one place.
 */
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

export type ProcessRuntimeIssueReflectionInput = {
  /** The parent agentic run that just finished. Used for precise correlation. */
  taskRunId: string | null;
  userId: string;
  agentId: string;
  threadId: string | null;
  routeContext: string;
  /**
   * Only consider PlatformIssueReport rows created at or after this time.
   * Callers usually capture `new Date()` before `runAgenticLoop` and pass
   * that through, so a reflection only inspects issues this run produced.
   */
  since: Date;
};

export type ProcessRuntimeIssueReflectionResult = {
  processed: number;
  skippedReason?: "reflection-loop-guard";
};

/**
 * Inspect PlatformIssueReport rows that this run produced (or, for legacy
 * rows missing taskRunId, ones that match agent/route/time) and emit
 * governed reflection evidence for each one.
 */
export async function processRuntimeIssueReflection(
  input: ProcessRuntimeIssueReflectionInput,
): Promise<ProcessRuntimeIssueReflectionResult> {
  // Layer 2 of the loop guard. The parent run's depth check is performed up
  // front so a recursive trigger short-circuits without DB work.
  if (input.taskRunId) {
    const parent = await prisma.taskRun
      .findUnique({
        where: { taskRunId: input.taskRunId },
        select: { source: true, title: true, a2aMetadata: true },
      })
      .catch(() => null);
    if (parent && (isReflectionRun(parent) || getReflectionDepth(parent) >= 1)) {
      return { processed: 0, skippedReason: "reflection-loop-guard" };
    }
  }

  // Precise correlation by taskRunId when present (every new row from
  // runtime-issues.ts carries it). Fall back to agent + route + time window
  // for legacy rows; emit a warn so we can spot un-migrated callers.
  const baseFilter = {
    type: "agent_stuck",
    source: "coworker_runtime",
    createdAt: { gte: input.since },
  } satisfies Prisma.PlatformIssueReportWhereInput;

  let rows: Array<{
    id: string;
    reportId: string;
    title: string;
    description: string | null;
    routeContext: string | null;
    agentId: string | null;
    threadId: string | null;
    taskRunId: string | null;
  }>;

  if (input.taskRunId) {
    rows = await prisma.platformIssueReport.findMany({
      where: { ...baseFilter, taskRunId: input.taskRunId },
      select: {
        id: true,
        reportId: true,
        title: true,
        description: true,
        routeContext: true,
        agentId: true,
        threadId: true,
        taskRunId: true,
      },
    });
  } else {
    console.warn(
      "[reflection-triggers] no taskRunId on parent run — falling back to agent/route/time correlation",
    );
    rows = await prisma.platformIssueReport.findMany({
      where: {
        ...baseFilter,
        agentId: input.agentId,
        routeContext: input.routeContext,
      },
      select: {
        id: true,
        reportId: true,
        title: true,
        description: true,
        routeContext: true,
        agentId: true,
        threadId: true,
        taskRunId: true,
      },
    });
  }

  let processed = 0;
  for (const row of rows) {
    try {
      await reflectOnIssue({
        parentTaskRunId: input.taskRunId,
        userId: input.userId,
        agentId: input.agentId,
        threadId: input.threadId,
        routeContext: input.routeContext,
        issue: row,
      });
      processed++;
    } catch (err) {
      // Reflection must never break the user response path. Log and keep
      // processing the next row.
      console.warn(
        `[reflection-triggers] failed for PlatformIssueReport ${row.reportId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { processed };
}

async function reflectOnIssue(input: {
  parentTaskRunId: string | null;
  userId: string;
  agentId: string;
  threadId: string | null;
  routeContext: string;
  issue: {
    reportId: string;
    title: string;
    description: string | null;
    taskRunId: string | null;
  };
}): Promise<void> {
  const parentDepth = await readParentReflectionDepth(input.parentTaskRunId);

  // Spawn a proactive TaskRun for the reflection so the evidence is
  // attributable. Stamp reflectionDepth onto a2aMetadata.
  const reflectionTaskRunId = `TR-RFL-${randomUUID().slice(0, 8).toUpperCase()}`;
  const reflectionRun = await prisma.taskRun.create({
    data: {
      taskRunId: reflectionTaskRunId,
      userId: input.userId,
      threadId: input.threadId,
      contextId: input.threadId,
      initiatingAgentId: input.agentId,
      currentAgentId: input.agentId,
      parentTaskRunId: input.parentTaskRunId,
      routeContext: input.routeContext,
      title: REFLECTION_TITLE,
      objective:
        `Reflect on PlatformIssueReport ${input.issue.reportId} and file durable evidence ` +
        `(self-assessment, capability need, improvement signal).`,
      source: "proactive",
      status: "working",
      authorityScope: [],
      a2aMetadata: {
        trigger: "runtime-issue-reflection",
        platformIssueReportId: input.issue.reportId,
        reflectionDepth: parentDepth + 1,
      } as Prisma.InputJsonValue,
    },
    select: { id: true, taskRunId: true },
  });

  // Self-assessment + skill need. Reuses submitCoworkerSelfAssessment so the
  // existing review surfaces show the row without changes.
  const { submitCoworkerSelfAssessment } = await import(
    "@/lib/coworker-self-assessment/assessment-service"
  );
  await submitCoworkerSelfAssessment({
    agentId: input.agentId,
    trigger: "runtime-issue-reflection",
    routeContext: input.routeContext,
    verdict: "gaps",
    confidence: "medium",
    missionSummary: input.issue.title,
    capabilitySummary:
      "The coworker hit the repeated-tool guard. A skill or workflow change is likely required.",
    rawPayload: {
      platformIssueReportId: input.issue.reportId,
      reflectionTaskRunId: reflectionRun.taskRunId,
    },
    needs: [
      {
        kind: "skill",
        severity: "important",
        need:
          "Add or update the coworker skill that handles this workflow so it does not retry " +
          "with identical arguments after a failure.",
        blocks: input.issue.title,
        evidenceJson: {
          platformIssueReportId: input.issue.reportId,
          threadId: input.threadId,
          taskRunId: input.parentTaskRunId,
          routeContext: input.routeContext,
        },
      },
    ],
  });

  // Emit a deduped ImprovementSignal so the portfolio flywheel can prioritize
  // across signals. Sourcing on the public reportId is intentional: re-firing
  // reflection over the same issue increments recurrenceCount.
  await createOrTouchImprovementSignal({
    sourceType: "platform_issue_report",
    sourceId: input.issue.reportId,
    title: input.issue.title,
    description: input.issue.description ?? null,
    evidence: {
      threadId: input.threadId,
      parentTaskRunId: input.parentTaskRunId,
      reflectionTaskRunId: reflectionRun.taskRunId,
    },
    routeContext: input.routeContext,
    agentId: input.agentId,
    threadId: input.threadId,
    suspectedRootCause: "repeated-tool-call",
  });

  // Mark the reflection run completed. The user-facing run is unaffected.
  await prisma.taskRun.update({
    where: { id: reflectionRun.id },
    data: { status: "completed", completedAt: new Date() },
  });
}

async function readParentReflectionDepth(parentTaskRunId: string | null): Promise<number> {
  if (!parentTaskRunId) return 0;
  const parent = await prisma.taskRun
    .findUnique({
      where: { taskRunId: parentTaskRunId },
      select: { source: true, title: true, a2aMetadata: true },
    })
    .catch(() => null);
  return getReflectionDepth(parent);
}
