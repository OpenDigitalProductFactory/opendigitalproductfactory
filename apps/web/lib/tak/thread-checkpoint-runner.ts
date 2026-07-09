// apps/web/lib/tak/thread-checkpoint-runner.ts
// Server-side wiring for the durable rolling checkpoint (BI-FDECBE0A).
// Binds the pure fold logic in thread-checkpoint.ts to prisma + the routed
// summarizer. Kept separate from the pure core so the fold math stays
// DB-and-model-free for unit tests, and so the P2 sleep-time pass can reuse the
// same advance without going through the coworker send path.

import { prisma } from "@dpf/db";
import {
  advanceThreadCheckpoint,
  formatCheckpointMessage,
  type AdvanceDeps,
  type ThreadCheckpointState,
} from "./thread-checkpoint";

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
    loadMessagesAfter: async (threadId, after) => {
      const rows = await prisma.agentMessage.findMany({
        where: {
          threadId,
          role: { in: ["user", "assistant"] },
          ...(after ? { createdAt: { gt: after } } : {}),
        },
        orderBy: { createdAt: "asc" },
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
  };
}

/**
 * Fold aged-out turns into the thread's durable checkpoint. Safe to call
 * fire-and-forget after a turn; a no-op until a batch has aged out.
 */
export async function advanceThreadCheckpointForThread(
  threadId: string,
  keepRecentCount: number,
): Promise<void> {
  await advanceThreadCheckpoint(threadId, keepRecentCount, prismaDeps());
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
