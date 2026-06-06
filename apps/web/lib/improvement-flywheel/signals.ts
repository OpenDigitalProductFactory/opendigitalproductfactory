// ImprovementSignal writer for the governed Hermes-style learning loop.
//
// `2026-04-05-continuous-improvement-flywheel-design.md` owns the full
// signal-routing and prioritization (top-N ranking) pipeline. This module
// preserves the (sourceType, sourceId) dedupe contract so a re-fired reflection
// over the same source increments recurrenceCount instead of producing
// duplicate rows.
//
// EP-INTAKE-UNIFY / BI-B716B387: it also closes the signal→backlog gap. A
// signal that becomes PERSISTENT (recurs to SIGNAL_BACKLOG_THRESHOLD) is filed
// once through the shared backlog front door and back-linked via
// ImprovementSignal.backlogItemId. One-off signals stay evidence-only, so the
// backlog stays low-noise without a scheduled evaluation. The backlog's own
// triage does prioritization — this is intake, not ranking.

import { randomUUID } from "crypto";

import type { Prisma } from "@dpf/db";
import { prisma } from "@dpf/db";

import { ingestBacklogItem } from "@/lib/operate/backlog-ingest";
import type { BacklogWorkType } from "@/lib/explore/backlog";

/**
 * A signal that has recurred this many times is worth a BacklogItem. Recurrence
 * is the only persistence signal the schema carries (there is no severity), so
 * it is the gate. Tunable; the flywheel design may later replace this with a
 * ranked top-N evaluation.
 */
export const SIGNAL_BACKLOG_THRESHOLD = 3;

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

/** Files a persistent signal into the backlog. Returns the item id, or null when
 *  projection failed (non-fatal — the signal is still recorded). */
export type FileSignalBacklogItemFn = (input: {
  signalId: string;
  sourceType: string;
  sourceId: string;
  title: string;
  description?: string | null;
  suspectedRootCause?: string | null;
  objectiveImpactHypothesis?: string | null;
  recurrenceCount: number;
  routeContext?: string | null;
  agentId?: string | null;
}) => Promise<{ itemId: string } | null>;

export type ImprovementSignalDeps = {
  fileBacklogItem?: FileSignalBacklogItemFn;
};

function makeSignalId(): string {
  return `IS-${randomUUID().slice(0, 8).toUpperCase()}`;
}

/** Map a signal source vocabulary to a backlog workType (advisory for triage). */
export function signalSourceTypeToWorkType(sourceType: string): BacklogWorkType {
  const s = sourceType.toLowerCase();
  if (s.includes("skill") || s.includes("curation")) return "skill";
  if (s.includes("tool")) return "tool";
  if (s.includes("doc")) return "doc";
  // Reflection / issue-report / correction friction is defect-class by default.
  return "bug";
}

function defaultFileSignalBacklogItem(): FileSignalBacklogItemFn {
  return async (s) => {
    try {
      const res = await ingestBacklogItem({
        title: s.title,
        body: [
          s.description ?? null,
          s.suspectedRootCause ? `Suspected root cause: ${s.suspectedRootCause}` : null,
          s.objectiveImpactHypothesis ? `Impact hypothesis: ${s.objectiveImpactHypothesis}` : null,
          `Signal ${s.signalId} (${s.sourceType}:${s.sourceId})`,
          `Recurrence: ${s.recurrenceCount}`,
        ]
          .filter(Boolean)
          .join("\n"),
        workType: signalSourceTypeToWorkType(s.sourceType),
        source: "automated-detection",
        itemIdPrefix: "SIG",
        agentId: s.agentId ?? null,
        origin: { kind: "improvement-signal", id: s.signalId },
      });
      return { itemId: res.itemId };
    } catch (err) {
      // Non-fatal: the signal is still recorded even if the projection fails.
      console.error("[improvement-flywheel] signal backlog projection failed", err);
      return null;
    }
  };
}

/**
 * Insert a fresh ImprovementSignal row for `(sourceType, sourceId)` or, if one
 * already exists, bump its `recurrenceCount` and refresh `lastSeenAt` without
 * overwriting the original evidence. When the (post-increment) recurrence count
 * reaches SIGNAL_BACKLOG_THRESHOLD and the signal has not already been filed, it
 * is projected once into the backlog and back-linked.
 *
 * Dedupe lives on the schema's `@@unique([sourceType, sourceId])`. Callers MUST
 * supply a stable, source-derived `sourceId` — otherwise dedupe degrades to
 * per-row inserts.
 */
export async function createOrTouchImprovementSignal(
  input: CreateOrTouchImprovementSignalInput,
  deps?: ImprovementSignalDeps,
): Promise<CreateOrTouchImprovementSignalResult> {
  const fileBacklogItem = deps?.fileBacklogItem ?? defaultFileSignalBacklogItem();
  const where = {
    sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId },
  };

  const existing = await prisma.improvementSignal.findUnique({
    where,
    select: { signalId: true },
  });

  if (existing) {
    const updated = await prisma.improvementSignal.update({
      where,
      data: {
        recurrenceCount: { increment: 1 },
        lastSeenAt: new Date(),
      },
      select: { recurrenceCount: true, backlogItemId: true },
    });

    let backlogItemId = updated.backlogItemId ?? undefined;
    if (!backlogItemId && updated.recurrenceCount >= SIGNAL_BACKLOG_THRESHOLD) {
      const filed = await fileBacklogItem({
        signalId: existing.signalId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        title: input.title,
        description: input.description ?? null,
        suspectedRootCause: input.suspectedRootCause ?? null,
        objectiveImpactHypothesis: input.objectiveImpactHypothesis ?? null,
        recurrenceCount: updated.recurrenceCount,
        routeContext: input.routeContext ?? null,
        agentId: input.agentId ?? null,
      });
      if (filed?.itemId) {
        backlogItemId = filed.itemId;
        await prisma.improvementSignal.update({ where, data: { backlogItemId: filed.itemId } });
      }
    }

    return {
      signalId: existing.signalId,
      isNew: false,
      ...(backlogItemId ? { backlogItemId } : {}),
    };
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
  // A brand-new signal (recurrenceCount=1) is below threshold — evidence only.
  return { signalId, isNew: true };
}
