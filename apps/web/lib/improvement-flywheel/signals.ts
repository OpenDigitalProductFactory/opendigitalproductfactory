// Minimal ImprovementSignal writer for the governed Hermes-style learning loop.
//
// `2026-04-05-continuous-improvement-flywheel-design.md` owns the full
// signal-routing and prioritization pipeline. This module is a thin writer
// the reflection plane uses to emit governed evidence — it does NOT make
// prioritization decisions or implement the top-3 selection logic. The
// schema (PR #623) carries the columns; this module preserves the
// (sourceType, sourceId) dedupe contract so a re-fired reflection over the
// same PlatformIssueReport increments recurrenceCount instead of producing
// duplicate rows.

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
};

function makeSignalId(): string {
  return `IS-${randomUUID().slice(0, 8).toUpperCase()}`;
}

/**
 * Insert a fresh ImprovementSignal row for `(sourceType, sourceId)` or, if
 * one already exists, bump its `recurrenceCount` and refresh `lastSeenAt`
 * without overwriting the original evidence. Returns the public `signalId`
 * and an `isNew` flag the caller can use for log/notification copy.
 *
 * Dedupe lives on the schema's `@@unique([sourceType, sourceId])`. Callers
 * MUST supply a stable, source-derived `sourceId` (e.g. the PlatformIssueReport's
 * public reportId) — otherwise dedupe degrades to per-row inserts.
 */
export async function createOrTouchImprovementSignal(
  input: CreateOrTouchImprovementSignalInput,
): Promise<CreateOrTouchImprovementSignalResult> {
  const existing = await prisma.improvementSignal.findUnique({
    where: { sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId } },
    select: { signalId: true },
  });

  if (existing) {
    await prisma.improvementSignal.update({
      where: { sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId } },
      data: {
        recurrenceCount: { increment: 1 },
        lastSeenAt: new Date(),
      },
    });
    return { signalId: existing.signalId, isNew: false };
  }

  const signalId = makeSignalId();
  await prisma.improvementSignal.create({
    data: {
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
  });
  return { signalId, isNew: true };
}
