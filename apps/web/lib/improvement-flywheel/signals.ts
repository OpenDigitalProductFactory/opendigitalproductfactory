// Shared source-identity boundary for the governed learning loop.
// Re-delivery is not an independent occurrence. The cross-Workroom learning
// design owns occurrence/hypothesis assessment; this writer retains evidence
// without promoting retries or legacy recurrence counts into backlog work.

import { randomUUID } from "crypto";

import type { Prisma } from "@dpf/db";
import { prisma } from "@dpf/db";

export type CreateOrTouchImprovementSignalInput = {
  /** Source vocabulary (e.g. "platform_issue_report", "user_correction"). */
  sourceType: string;
  /** Stable id of the source row (reportId, threadId, etc.). */
  sourceId: string;
  title: string;
  description?: string | null;
  evidence?: Record<string, unknown>;
  routeContext?: string | null;
  agentId?: string | null;
  threadId?: string | null;
  buildId?: string | null;
  toolName?: string | null;
  suspectedRootCause?: string | null;
  objectiveImpactHypothesis?: string | null;
};

export type CreateOrTouchImprovementSignalResult = {
  signalId: string;
  isNew: boolean;
  /** Set when this call projected (or found) the signal's BacklogItem. */
  backlogItemId?: string;
};

/**
 * Atomically insert or touch one source identity. Preserve original evidence,
 * legacy recurrence counts and existing backlog links on replay. In particular,
 * historical recurrenceCount values are not proof of independent occurrences.
 * Critical-finding intake remains with its existing source-specific owner.
 */
export async function createOrTouchImprovementSignal(
  input: CreateOrTouchImprovementSignalInput,
): Promise<CreateOrTouchImprovementSignalResult> {
  const signalId = `IS-${randomUUID().slice(0, 8).toUpperCase()}`;
  const row = await prisma.improvementSignal.upsert({
    where: {
      sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId },
    },
    create: {
      signalId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      title: input.title,
      description: input.description ?? null,
      evidence: (input.evidence ?? {}) as Prisma.InputJsonValue,
      routeContext: input.routeContext ?? null,
      agentId: input.agentId ?? null,
      threadId: input.threadId ?? null,
      buildId: input.buildId ?? null,
      toolName: input.toolName ?? null,
      suspectedRootCause: input.suspectedRootCause ?? null,
      objectiveImpactHypothesis: input.objectiveImpactHypothesis ?? null,
    },
    update: { lastSeenAt: new Date() },
    select: { signalId: true, backlogItemId: true },
  });
  return {
    signalId: row.signalId,
    isNew: row.signalId === signalId,
    ...(row.backlogItemId ? { backlogItemId: row.backlogItemId } : {}),
  };
}
