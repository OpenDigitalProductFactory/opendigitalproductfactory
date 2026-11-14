// apps/web/lib/tak/thread-checkpoint-runner.ts
// Server-side wiring for the durable rolling checkpoint (BI-FDECBE0A).
// Binds the pure fold logic in thread-checkpoint.ts to prisma, the routed
// summarizer and the improvement-signal store. Kept separate from the pure core
// so the fold math stays DB-and-model-free for unit tests, and so the P2
// sleep-time pass can reuse the same advance without going through the coworker
// send path.

import { prisma } from "@dpf/db";
import {
  advanceThreadCheckpoint,
  formatCheckpointMessage,
  type AdvanceDeps,
  type AdvanceResult,
  type FoldOutcome,
  type ThreadCheckpointState,
} from "./thread-checkpoint";

/**
 * The roles a fold reads. The backlog finder counts exactly these, so a thread
 * it admits is one the fold can act on.
 */
export const FOLD_MESSAGE_ROLES = ["user", "assistant"] as const;

/** A thread and how many foldable messages sit after its own watermark. */
export type ThreadFoldBacklog = { id: string; contextKey: string; unfolded: number };

/**
 * BI-546A9E36: the threads that are at least `minUnfolded` foldable messages
 * behind their own watermark, most-behind first.
 *
 * This is the nightly sweep's admission rule. It replaced two timestamp-based
 * selections (the most recently updated threads, plus stale ones oldest-first),
 * both with fixed caps: on an install with 404 active threads the first left 304
 * unswept, and in the second a quiet thread with nothing to fold kept its slot
 * for as long as it received a message a fortnight, starving the threads behind
 * it. Ordering by need has neither fault: a thread with nothing to fold is never
 * a candidate, and one the sweep did not reach tonight is still at the front
 * tomorrow.
 *
 * One query per sweep. The count has to compare each message against its own
 * thread's watermark, which the query builder cannot express across a relation,
 * hence the raw statement.
 */
export async function findThreadsWithFoldBacklog(args: {
  minUnfolded: number;
  take: number;
}): Promise<ThreadFoldBacklog[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; contextKey: string; unfolded: number | bigint }>>`
    SELECT t."id", t."contextKey", b."unfolded"
    FROM "AgentThread" t
    CROSS JOIN LATERAL (
      SELECT count(*) AS "unfolded"
      FROM "AgentMessage" m
      WHERE m."threadId" = t."id"
        AND m."role" = ANY(${[...FOLD_MESSAGE_ROLES]}::text[])
        AND (t."compactionWatermarkAt" IS NULL OR m."createdAt" > t."compactionWatermarkAt")
    ) b
    WHERE t."cancelledAt" IS NULL
      AND b."unfolded" >= ${args.minUnfolded}
    ORDER BY b."unfolded" DESC, t."id" ASC
    LIMIT ${args.take}`;
  return rows.map((row) => ({ id: row.id, contextKey: row.contextKey, unfolded: Number(row.unfolded) }));
}

/** ImprovementSignal.sourceType values a fold writes; query on these to see fold health. */
export const THREAD_CHECKPOINT_FOLD_FAILED_SIGNAL = "thread_checkpoint_fold_failed";
export const THREAD_CHECKPOINT_MESSAGE_SKIPPED_SIGNAL = "thread_checkpoint_message_skipped";

/**
 * A fold outcome becomes a durable, queryable ImprovementSignal (the platform's
 * existing signal substrate: deduped on (sourceType, sourceId), recurrence
 * counted, filed into the backlog once it persists). The reason lives in the
 * sourceId so a recurring failure of a different kind is a different row, not a
 * bumped counter on the first one.
 */
export function foldOutcomeToSignal(outcome: FoldOutcome): {
  sourceType: string;
  sourceId: string;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  routeContext: string;
  threadId: string;
  suspectedRootCause: string;
} {
  const at = new Date().toISOString();
  if (outcome.kind === "fold-failed") {
    return {
      sourceType: THREAD_CHECKPOINT_FOLD_FAILED_SIGNAL,
      sourceId: `${outcome.threadId}:${outcome.stage}`,
      title: `Thread checkpoint fold failed at ${outcome.stage} on thread ${outcome.threadId}`,
      description:
        `advanceThreadCheckpoint failed at stage "${outcome.stage}" with ${outcome.eligibleCount} eligible message(s): ${outcome.message}. ` +
        `Until a fold succeeds the thread has no checkpoint, no injected summary, and no prunable span (BI-FDECBE0A D1).`,
      evidence: { threadId: outcome.threadId, stage: outcome.stage, message: outcome.message, eligibleCount: outcome.eligibleCount, at },
      routeContext: "thread-checkpoint",
      threadId: outcome.threadId,
      suspectedRootCause: `${outcome.stage}: ${outcome.message}`,
    };
  }
  return {
    sourceType: THREAD_CHECKPOINT_MESSAGE_SKIPPED_SIGNAL,
    sourceId: outcome.threadId,
    title: `Thread checkpoint skipped an oversized message on thread ${outcome.threadId}`,
    description:
      `Message ${outcome.messageId} (${outcome.role}, ${outcome.chars} chars ≈ ${outcome.estimatedTokens} estimated tokens) ` +
      `exceeds the ${outcome.budgetTokens}-token fold budget; it was announced to the summarizer as omitted and the watermark moved past it. ` +
      `A thread that keeps producing such messages wants retention or record-first compaction, not a bigger summarizer.`,
    evidence: {
      threadId: outcome.threadId,
      reason: outcome.reason,
      messageId: outcome.messageId,
      role: outcome.role,
      chars: outcome.chars,
      estimatedTokens: outcome.estimatedTokens,
      budgetTokens: outcome.budgetTokens,
      at,
    },
    routeContext: "thread-checkpoint",
    threadId: outcome.threadId,
    suspectedRootCause: `${outcome.reason}: message ${outcome.messageId} is ${outcome.chars} chars`,
  };
}

function prismaDeps(): AdvanceDeps {
  return {
    loadState: async (threadId) => {
      const t = await prisma.agentThread.findUnique({
        where: { id: threadId },
        select: {
          compactedSummary: true,
          compactionWatermarkAt: true,
          compactedTurnCount: true,
        },
      });
      return t as ThreadCheckpointState | null;
    },
    loadMessagesAfter: async (threadId, after, take) => {
      const rows = await prisma.agentMessage.findMany({
        where: {
          threadId,
          role: { in: [...FOLD_MESSAGE_ROLES] },
          ...(after ? { createdAt: { gt: after } } : {}),
        },
        orderBy: { createdAt: "asc" },
        take,
        select: { id: true, role: true, content: true, createdAt: true },
      });
      return rows;
    },
    saveState: async (threadId, state) => {
      await prisma.agentThread.update({
        where: { id: threadId },
        data: {
          compactedSummary: state.compactedSummary,
          compactionWatermarkAt: state.compactionWatermarkAt,
          compactedTurnCount: state.compactedTurnCount,
        },
      });
    },
    summarize: async ({ priorSummary, transcript }) => {
      const { routeAndCall } = await import("@/lib/inference/routed-inference");
      const priorBlock = priorSummary
        ? `Existing running summary (extend it, do not repeat it):\n${priorSummary}\n\n`
        : "";
      const result = await routeAndCall(
        [
          {
            role: "user",
            content:
              `${priorBlock}New conversation turns to fold into the running summary. ` +
              `Produce ONE updated running summary in 3–6 sentences. Preserve every ` +
              `decision, commitment, open question, and durable fact; drop pleasantries ` +
              `and superseded detail.\n\n${transcript}`,
          },
        ],
        "You maintain a durable rolling summary of a work conversation. Output only the updated summary — no preamble.",
        "internal",
        { taskType: "analysis" },
      );
      return result.content;
    },
    recordFoldOutcome: async (outcome) => {
      const { createOrTouchImprovementSignal } = await import("@/lib/improvement-flywheel/signals");
      await createOrTouchImprovementSignal(foldOutcomeToSignal(outcome));
    },
  };
}

/**
 * Fold one batch of aged-out turns into the thread's durable checkpoint. Safe to
 * call fire-and-forget after a turn; a no-op until a batch has aged out. Returns
 * the outcome so a sweep can keep advancing while `moreEligible` holds.
 */
export async function advanceThreadCheckpointForThread(
  threadId: string,
  keepRecentCount: number,
): Promise<AdvanceResult> {
  return advanceThreadCheckpoint(threadId, keepRecentCount, prismaDeps());
}

/**
 * Load the durable checkpoint as a history message to prepend ahead of the
 * recency window. Null when the thread has no checkpoint yet (strict no-op).
 */
export async function loadThreadCheckpointMessage(
  threadId: string,
): Promise<{ role: "user"; content: string } | null> {
  const t = await prisma.agentThread.findUnique({
    where: { id: threadId },
    select: { compactedSummary: true, compactedTurnCount: true },
  });
  return formatCheckpointMessage(t);
}
