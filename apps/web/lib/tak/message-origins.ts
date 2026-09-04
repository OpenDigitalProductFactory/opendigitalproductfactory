import type { ChatMessage } from "@/lib/inference/ai-inference";
import type { MessageOrigin } from "@/lib/inference/data-screening/types";

/** A chat history and the positional labels that describe it, kept in step. */
export type LabelledHistory = {
  messages: ChatMessage[];
  origins: MessageOrigin[];
};

/**
 * Start tracking what each message IS, alongside the messages themselves.
 *
 * A screen receipt can say a match landed at `messages[0].content`, which is
 * ambiguous between a real user turn and a block the coworker path prepended —
 * and those imply opposite fixes. `rawPayloadStored` is false by design, so the
 * payload cannot be read back to settle it, but a LABEL is safe to persist where
 * the content is not (BI-40EF7C44).
 *
 * Everything starts as `turn`; only a caller that knows better says otherwise.
 */
export function labelHistory(messages: ChatMessage[]): LabelledHistory {
  return { messages, origins: messages.map(() => "turn") };
}

/**
 * Prepend a platform-generated message and record what it was.
 *
 * The two arrays are positional, so they must move together — prepending to one
 * without the other silently mislabels every message after it. Doing both in one
 * call is what makes that impossible rather than merely discouraged.
 */
export function prependLabelled(
  history: LabelledHistory,
  message: ChatMessage,
  origin: MessageOrigin,
): LabelledHistory {
  return {
    messages: [message, ...history.messages],
    origins: [origin, ...history.origins],
  };
}
