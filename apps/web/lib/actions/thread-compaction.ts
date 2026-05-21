// apps/web/lib/actions/thread-compaction.ts
// Rolling coworker thread compaction — EP-COST Phase 3.
//
// When a coworker thread accumulates more than COMPACTION_THRESHOLD turns,
// the oldest COMPACTION_BATCH turns are replaced by a single summary message.
// This fires repeatedly (at 21, 31, 41, …) so the thread never grows past
// COMPACTION_THRESHOLD + COMPACTION_BATCH messages regardless of session length.
//
// Design notes:
// - The summary call uses the "analysis" task type (routes to a cheaper model).
// - Summary messages use role: "user" with a [THREAD SUMMARY] prefix so they
//   are valid ChatMessage entries for all providers.
// - Errors in the summarization call are non-fatal: the original messages are
//   returned unchanged so the coworker can still respond.

import type { ChatMessage } from "@/lib/ai-inference";

/** Trigger compaction when message count exceeds this threshold. */
export const COMPACTION_THRESHOLD = 20;

/** Number of oldest messages to summarize in each compaction cycle. */
export const COMPACTION_BATCH = 10;

/**
 * Returns true if the message list is long enough to trigger compaction.
 * Callers should loop: `while (shouldCompact(msgs)) msgs = await compactOldest(msgs)`
 */
export function shouldCompact(messages: ChatMessage[]): boolean {
  return messages.length > COMPACTION_THRESHOLD;
}

/**
 * Summarizes the oldest COMPACTION_BATCH messages into a single summary
 * entry and returns the new (shorter) message list.
 *
 * The summary call uses `routeAndCall` with taskType "analysis" so it
 * routes to a cheap/routine-tier model rather than the full Sonnet/Opus.
 */
export async function compactOldest(
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  const toCompact = messages.slice(0, COMPACTION_BATCH);
  const rest = messages.slice(COMPACTION_BATCH);

  try {
    const { routeAndCall } = await import("@/lib/inference/routed-inference");

    const transcript = toCompact
      .map((m) => {
        const role = m.role === "assistant" ? "Agent" : "User";
        const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return `${role}: ${text.slice(0, 800)}`;
      })
      .join("\n\n");

    const result = await routeAndCall(
      [
        {
          role: "user",
          content:
            `Summarize the following conversation excerpt in 2–4 sentences. ` +
            `Preserve all decisions made, actions taken, and key facts. ` +
            `Omit pleasantries and filler.\n\n${transcript}`,
        },
      ],
      "You are a conversation summarizer. Output only the summary — no preamble.",
      "internal",
      { taskType: "analysis" },
    );

    const summaryMessage: ChatMessage = {
      role: "user",
      content: `[THREAD SUMMARY — ${toCompact.length} earlier turns condensed]: ${result.content}`,
    };

    return [summaryMessage, ...rest];
  } catch (err) {
    // Summarization failed — return original messages so the coworker still works.
    console.warn("[thread-compaction] Summarization failed, returning original messages:", err);
    return messages;
  }
}

/**
 * Applies rolling compaction until the message list is within the threshold.
 * Safe to call unconditionally — returns messages unchanged if no compaction needed.
 */
export async function applyRollingCompaction(
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  let result = messages;
  let iterations = 0;
  while (shouldCompact(result) && iterations < 5) {
    result = await compactOldest(result);
    iterations++;
  }
  return result;
}
