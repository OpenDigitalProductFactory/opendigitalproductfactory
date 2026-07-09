// apps/web/lib/tak/thread-checkpoint.ts
// Durable rolling compaction checkpoint — BI-FDECBE0A (EP-8C706944 Phase 1).
//
// The coworker send path loads only a bounded recency window (8 chat / 20 build
// messages) plus vector recall; everything older is invisible unless semantic
// recall happens to surface it, and the in-flight `thread-compaction.ts` summary
// is recomputed from scratch every turn and never persisted.
//
// This module maintains a PERSISTED running summary of every turn older than the
// recency window, on AgentThread.compactedSummary. A watermark
// (compactionWatermarkAt = createdAt of the newest message already folded)
// guarantees each message is summarized at most once: the advance job only reads
// messages strictly newer than the watermark, folds a batch into the summary, and
// moves the watermark forward. Injecting the checkpoint gives long threads
// continuity that does not depend on vector recall, and stops the per-turn
// re-summarization spend.
//
// Both the summarizer and the store are dependency-injected so the fold logic is
// unit-testable without a model or a database.

/** A message the fold job considers, oldest-first. */
export type CheckpointMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
};

/** Persisted checkpoint state for a thread. */
export type ThreadCheckpointState = {
  compactedSummary: string | null;
  compactionWatermarkAt: Date | null;
  compactedTurnCount: number;
};

/**
 * Minimum number of aged-out (older-than-window, newer-than-watermark) messages
 * that must accumulate before we spend an LLM call to fold them. Keeps the fold
 * coarse-grained and cache-friendly rather than one summary call per turn.
 */
export const CHECKPOINT_FOLD_BATCH = 10;

/** Hard cap on the persisted summary length so it can never dominate context. */
export const CHECKPOINT_SUMMARY_CHAR_CAP = 4000;

export type Summarize = (args: {
  priorSummary: string | null;
  transcript: string;
}) => Promise<string>;

export type AdvanceDeps = {
  /** Load the thread's current checkpoint state. */
  loadState: (threadId: string) => Promise<ThreadCheckpointState | null>;
  /**
   * Load conversation messages (role user/assistant) with createdAt strictly
   * greater than `after` (or all, when null), oldest-first.
   */
  loadMessagesAfter: (
    threadId: string,
    after: Date | null,
  ) => Promise<CheckpointMessage[]>;
  /** Persist the advanced checkpoint. */
  saveState: (threadId: string, state: ThreadCheckpointState) => Promise<void>;
  summarize: Summarize;
};

export type AdvanceResult =
  | { advanced: false; reason: "no-thread" | "not-enough" | "error" }
  | { advanced: true; foldedCount: number; watermarkAt: Date };

function renderTranscript(messages: CheckpointMessage[]): string {
  return messages
    .map((m) => {
      const who = m.role === "assistant" ? "Agent" : "User";
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${who}: ${text.slice(0, 800)}`;
    })
    .join("\n\n");
}

/**
 * Fold the aged-out messages (older than the newest `keepRecentCount`, newer than
 * the watermark) into the durable summary. Idempotent and safe to call
 * fire-and-forget after every turn: a no-op until CHECKPOINT_FOLD_BATCH messages
 * have aged out, and it never re-reads messages already behind the watermark.
 */
export async function advanceThreadCheckpoint(
  threadId: string,
  keepRecentCount: number,
  deps: AdvanceDeps,
): Promise<AdvanceResult> {
  try {
    const state = await deps.loadState(threadId);
    if (!state) return { advanced: false, reason: "no-thread" };

    const sinceWatermark = await deps.loadMessagesAfter(
      threadId,
      state.compactionWatermarkAt,
    );
    // Only messages that have aged OUT of the live recency window are eligible —
    // keep the newest `keepRecentCount` untouched (they are still sent verbatim).
    const eligible =
      keepRecentCount > 0 ? sinceWatermark.slice(0, -keepRecentCount) : sinceWatermark;

    if (eligible.length < CHECKPOINT_FOLD_BATCH) {
      return { advanced: false, reason: "not-enough" };
    }

    const newestFolded = eligible[eligible.length - 1]!;
    const summary = await deps.summarize({
      priorSummary: state.compactedSummary,
      transcript: renderTranscript(eligible),
    });
    const capped =
      summary.length > CHECKPOINT_SUMMARY_CHAR_CAP
        ? summary.slice(0, CHECKPOINT_SUMMARY_CHAR_CAP)
        : summary;

    await deps.saveState(threadId, {
      compactedSummary: capped,
      compactionWatermarkAt: newestFolded.createdAt,
      compactedTurnCount: state.compactedTurnCount + eligible.length,
    });

    return { advanced: true, foldedCount: eligible.length, watermarkAt: newestFolded.createdAt };
  } catch (err) {
    // Non-fatal: a failed fold must never break the coworker turn.
    console.warn("[thread-checkpoint] advance failed:", err);
    return { advanced: false, reason: "error" };
  }
}

/**
 * Render the persisted checkpoint as a single history message to prepend ahead of
 * the recency window. Returns null when there is no checkpoint (strict no-op).
 */
export function formatCheckpointMessage(
  state: Pick<ThreadCheckpointState, "compactedSummary" | "compactedTurnCount"> | null,
): { role: "user"; content: string } | null {
  if (!state?.compactedSummary) return null;
  const turns = state.compactedTurnCount;
  return {
    role: "user",
    content: `[CONVERSATION SO FAR — durable summary of ${turns} earlier turn${turns === 1 ? "" : "s"}]: ${state.compactedSummary}`,
  };
}
