// Shared improvement-signal intake. Immutable issue reports are replay-safe;
// recurring observers retain their existing persistence-to-backlog contract.
// See docs/architecture/improvement-signal-intake.md for the scope boundary.

import { randomUUID } from "crypto";

import type { Prisma } from "@dpf/db";
import { prisma } from "@dpf/db";

import { ingestBacklogItem } from "@/lib/operate/backlog-ingest";
import { toolDefectOrigin } from "@/lib/operate/tool-defect-origin";
import type { BacklogWorkType } from "@/lib/explore/backlog";

export const SIGNAL_BACKLOG_THRESHOLD = 3;

export function signalSourceTypeToWorkType(sourceType: string): BacklogWorkType {
  const source = sourceType.toLowerCase();
  if (source.includes("skill") || source.includes("curation")) return "skill";
  if (source.includes("tool")) return "tool";
  if (source.includes("doc")) return "doc";
  return "bug";
}

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
  evidence?: unknown;
}) => Promise<{ itemId: string } | null>;

export type ImprovementSignalDeps = { fileBacklogItem?: FileSignalBacklogItemFn };

const filePersistentSignal: FileSignalBacklogItemFn = async (signal) => {
  try {
    const result = await ingestBacklogItem({
      title: signal.title,
      body: [
        signal.description,
        signal.suspectedRootCause ? `Suspected root cause: ${signal.suspectedRootCause}` : null,
        signal.objectiveImpactHypothesis ? `Impact hypothesis: ${signal.objectiveImpactHypothesis}` : null,
        `Signal ${signal.signalId} (${signal.sourceType}:${signal.sourceId})`,
        `Recurrence: ${signal.recurrenceCount}`,
      ].filter(Boolean).join("\n"),
      workType: signalSourceTypeToWorkType(signal.sourceType),
      source: "automated-detection",
      itemIdPrefix: "SIG",
      agentId: signal.agentId ?? null,
      // A repeated tool failure files under its tool, not this per-agent+route
      // signal, so every coworker's observation lands on one item (BI-891E4E11).
      origin: toolDefectOrigin(signal.evidence) ?? { kind: "improvement-signal", id: signal.signalId },
    });
    return { itemId: result.itemId };
  } catch (error) {
    console.error("[improvement-flywheel] signal backlog projection failed", error);
    return null;
  }
};

/**
 * One platform_issue_report id names one report, so repeat delivery only touches
 * it. Other sources keep the existing observer persistence contract until an
 * occurrence-aware replacement is qualified. Their counts are not proof of
 * independent occurrences or measured improvement benefit.
 */
export async function createOrTouchImprovementSignal(
  input: CreateOrTouchImprovementSignalInput,
  deps?: ImprovementSignalDeps,
): Promise<CreateOrTouchImprovementSignalResult> {
  const signalId = `IS-${randomUUID().slice(0, 8).toUpperCase()}`;
  const immutableSource = input.sourceType === "platform_issue_report";
  const where = { sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId } };
  const update = {
    lastSeenAt: new Date(),
    ...(immutableSource ? {} : { recurrenceCount: { increment: 1 } }),
  };
  const select = { signalId: true, backlogItemId: true, recurrenceCount: true } as const;
  const row = await prisma.improvementSignal.upsert({
    where,
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
    update,
    select,
  }).catch(async (error: unknown) => {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
    // Some Prisma adapters emulate upsert. The unique source key may race on
    // insert; update that exact winner once, never an unrelated signalId row.
    // If no source winner exists, propagate the failure instead of claiming success.
    return prisma.improvementSignal.update({ where, data: update, select });
  });
  let backlogItemId = row.backlogItemId ?? undefined;
  if (!immutableSource && !backlogItemId && row.recurrenceCount >= SIGNAL_BACKLOG_THRESHOLD) {
    const filed = await (deps?.fileBacklogItem ?? filePersistentSignal)({ ...input, signalId: row.signalId, recurrenceCount: row.recurrenceCount });
    if (filed?.itemId) {
      backlogItemId = filed.itemId;
      await prisma.improvementSignal.update({ where, data: { backlogItemId } });
    }
  }
  return {
    signalId: row.signalId,
    isNew: row.signalId === signalId,
    ...(backlogItemId ? { backlogItemId } : {}),
  };
}
