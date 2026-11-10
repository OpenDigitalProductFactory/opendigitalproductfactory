// apps/web/lib/tak/thread-checkpoint.ts
// Durable rolling compaction checkpoint — BI-FDECBE0A (EP-8C706944 Phase 1;
// re-opened 2026-09-16, design 2026-09-16-coworker-dialog-compaction-and-thread-
// economy-design.md §1 D1 / §7 Phase 2).
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
// The fold that bounds a thread is itself bounded (D1). One advance loads at
// most one batch plus the recency window, folds at most one batch, and offers
// the summarizer at most CHECKPOINT_FOLD_TOKEN_BUDGET estimated tokens of whole
// messages. A message that could never fit is skipped — announced in the
// transcript and recorded as a durable outcome — and the watermark still moves
// past it, so no single message can wedge a thread. A failed fold never breaks
// the coworker turn, but its stage and reason are returned and recorded rather
// than discarded.
//
// Both the summarizer and the store are dependency-injected so the fold logic is
// unit-testable without a model or a database.

import { estimateContextTokens } from "./context-pressure";

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
 * Batch size of the fold: the minimum number of aged-out (older-than-window,
 * newer-than-watermark) messages that must accumulate before we spend an LLM
 * call, AND the maximum number folded by one advance. Keeps the fold
 * coarse-grained and cache-friendly rather than one summary call per turn, and
 * lets a wedged thread converge across sweeps instead of failing forever on
 * one oversized call (D1).
 */
export const CHECKPOINT_FOLD_BATCH = 10;

/**
 * Upper bound on the estimated tokens (chars / 4) of transcript offered to the
 * summarizer in one fold. Sized for the local served window (24,576 tokens on
 * the operator install) with room for the prior summary, the instruction and
 * the output; the observed largest single message (17,027 chars ≈ 4,260
 * tokens) fits whole. Follows the Agent Framework rule the design adopts:
 * select whole messages that fit; a message that cannot fit is skipped, never
 * attempted.
 */
export const CHECKPOINT_FOLD_TOKEN_BUDGET = 6_000;

/** Hard cap on the persisted summary length so it can never dominate context. */
export const CHECKPOINT_SUMMARY_CHAR_CAP = 4000;

/**
 * How many messages one advance loads: one batch plus the recency window. A
 * full page proves at least one batch has aged out of the window (there are
 * `keepRecentCount` newer messages behind it); a short page is the whole
 * remaining span, from which the window is subtracted as before.
 */
export function checkpointLoadTake(keepRecentCount: number): number {
  return CHECKPOINT_FOLD_BATCH + Math.max(0, keepRecentCount);
}

export type Summarize = (args: {
  priorSummary: string | null;
  transcript: string;
}) => Promise<string>;

/** Where a fold failed, so the recorded signal names the stage, not just "error". */
export type FoldStage = "load-state" | "load-messages" | "summarize" | "save";

/** A message the fold passed over because it could never fit the token budget. */
export type FoldSkip = {
  messageId: string;
  role: string;
  chars: number;
  estimatedTokens: number;
  budgetTokens: number;
};

/**
 * The durable outcome of a fold that did not go to plan. Recorded through
 * `AdvanceDeps.recordFoldOutcome` so a failure is queryable, not a console line.
 */
export type FoldOutcome =
  | {
      kind: "fold-failed";
      threadId: string;
      stage: FoldStage;
      message: string;
      eligibleCount: number;
    }
  | {
      kind: "message-skipped";
      threadId: string;
      reason: "exceeds-token-budget";
      messageId: string;
      role: string;
      chars: number;
      estimatedTokens: number;
      budgetTokens: number;
    };

export type AdvanceDeps = {
  /** Load the thread's current checkpoint state. */
  loadState: (threadId: string) => Promise<ThreadCheckpointState | null>;
  /**
   * Load conversation messages (role user/assistant) with createdAt strictly
   * greater than `after` (or all, when null), oldest-first, at most `take`.
   */
  loadMessagesAfter: (
    threadId: string,
    after: Date | null,
    take: number,
  ) => Promise<CheckpointMessage[]>;
  /** Persist the advanced checkpoint. */
  saveState: (threadId: string, state: ThreadCheckpointState) => Promise<void>;
  summarize: Summarize;
  /**
   * Record a fold that failed or skipped a message. Called best-effort: a
   * throwing recorder is swallowed so it can never break the advance or the
   * coworker turn that fired it.
   */
  recordFoldOutcome: (outcome: FoldOutcome) => Promise<void>;
};

export type AdvanceResult =
  | { advanced: false; reason: "no-thread" | "not-enough" }
  | { advanced: false; reason: "error"; stage: FoldStage; message: string }
  | {
      advanced: true;
      /** Messages whose content went to the summarizer. */
      foldedCount: number;
      /** Messages the watermark passed without summarizing (recorded). */
      skipped: FoldSkip[];
      watermarkAt: Date;
      /** The loaded page was full, so another batch has probably aged out. */
      moreEligible: boolean;
    };

export type BoundedResumePacket = {
  mode: "full" | "metadata-only" | "handoff-required";
  payload: {
    summary?: string;
    recentMessages?: string[];
    evidenceRefs?: string[];
    omittedMessageCount?: number;
    evidenceRefCount?: number;
  };
  reason: string | null;
  originalBytes: number;
  serializedBytes: number;
  metrics: { payloadDowngradeCount: number };
};

function jsonByteLength(value: object): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function buildBoundedResumePacket(args: {
  summary: string | null;
  recentMessages: string[];
  evidenceRefs: string[];
  maxItems: number;
  maxBytes: number;
}): BoundedResumePacket {
  if (!Number.isInteger(args.maxItems) || args.maxItems < 0) {
    throw new RangeError("maxItems must be a non-negative integer");
  }
  if (!Number.isInteger(args.maxBytes) || args.maxBytes < 2) {
    throw new RangeError("maxBytes must be at least 2");
  }
  const fullPayload = {
    ...(args.summary ? { summary: args.summary } : {}),
    recentMessages: args.recentMessages,
    evidenceRefs: args.evidenceRefs,
  };
  const originalBytes = jsonByteLength(fullPayload);
  const itemCount = args.recentMessages.length + args.evidenceRefs.length;
  if (itemCount <= args.maxItems && originalBytes <= args.maxBytes) {
    return {
      mode: "full",
      payload: fullPayload,
      reason: null,
      originalBytes,
      serializedBytes: originalBytes,
      metrics: { payloadDowngradeCount: 0 },
    };
  }

  const metadataPayload = {
    ...(args.summary ? { summary: args.summary } : {}),
    evidenceRefs: args.evidenceRefs,
    omittedMessageCount: args.recentMessages.length,
  };
  const metadataBytes = jsonByteLength(metadataPayload);
  if (args.evidenceRefs.length <= args.maxItems
    && metadataBytes <= args.maxBytes) {
    return {
      mode: "metadata-only",
      payload: metadataPayload,
      reason: "Recent message content exceeded the configured resume budget; authoritative evidence metadata is preserved.",
      originalBytes,
      serializedBytes: metadataBytes,
      metrics: { payloadDowngradeCount: 1 },
    };
  }

  const handoffMetadata = {
    omittedMessageCount: args.recentMessages.length,
    evidenceRefCount: args.evidenceRefs.length,
  };
  const handoffPayload = jsonByteLength(handoffMetadata) <= args.maxBytes
    ? handoffMetadata
    : {};
  const handoffBytes = jsonByteLength(handoffPayload);
  return {
    mode: "handoff-required",
    payload: handoffPayload,
    reason: "Authoritative evidence metadata exceeds the configured resume budget; fetch it through a bounded handoff.",
    originalBytes,
    serializedBytes: handoffBytes,
    metrics: { payloadDowngradeCount: 1 },
  };
}

function speaker(role: string): string {
  return role === "assistant" ? "Agent" : "User";
}

function messageText(m: CheckpointMessage): string {
  return typeof m.content === "string" ? m.content : JSON.stringify(m.content);
}

/** One rendered transcript entry, exactly as the summarizer will see it. */
function renderEntry(m: CheckpointMessage): string {
  return `${speaker(m.role)}: ${messageText(m)}`;
}

/** Placeholder-not-silence: a span the summarizer does not see must announce itself. */
function renderSkip(skip: FoldSkip): string {
  return `[${speaker(skip.role)} message omitted from this fold: ${skip.chars} chars ≈ ${skip.estimatedTokens} estimated tokens exceeds the ${skip.budgetTokens}-token budget]`;
}

/** Estimated tokens of one rendered entry, on the shared chars/4 estimator. */
function estimateEntryTokens(role: string, entry: string): number {
  return estimateContextTokens([{ role, content: entry }], "");
}

type FoldSelection = {
  /** Transcript entries in message order, skips announced in place. */
  entries: string[];
  /** Messages whose content is in the transcript. */
  fold: CheckpointMessage[];
  skipped: FoldSkip[];
  /** Contiguous count of eligible messages the watermark will pass (fold + skipped). */
  consumed: number;
};

/**
 * Select, oldest-first, the whole messages that fit the token budget. A message
 * that would exceed the budget on its own is skipped (it can never fit) and the
 * selection continues; a message that merely does not fit the REMAINING budget
 * ends the selection and waits for the next advance. The first message is
 * therefore always either folded or skipped, so `consumed` is never 0 for a
 * non-empty input — the watermark always moves.
 */
export function selectFoldBatch(
  eligible: readonly CheckpointMessage[],
  budgetTokens: number = CHECKPOINT_FOLD_TOKEN_BUDGET,
): FoldSelection {
  const entries: string[] = [];
  const fold: CheckpointMessage[] = [];
  const skipped: FoldSkip[] = [];
  let used = 0;
  let consumed = 0;
  for (const m of eligible) {
    const entry = renderEntry(m);
    const tokens = estimateEntryTokens(m.role, entry);
    if (tokens > budgetTokens) {
      const skip: FoldSkip = {
        messageId: m.id,
        role: m.role,
        chars: messageText(m).length,
        estimatedTokens: tokens,
        budgetTokens,
      };
      skipped.push(skip);
      entries.push(renderSkip(skip));
      consumed += 1;
      continue;
    }
    if (used + tokens > budgetTokens) break;
    used += tokens;
    fold.push(m);
    entries.push(entry);
    consumed += 1;
  }
  return { entries, fold, skipped, consumed };
}

function capSummary(summary: string): string {
  return summary.length > CHECKPOINT_SUMMARY_CHAR_CAP
    ? summary.slice(0, CHECKPOINT_SUMMARY_CHAR_CAP)
    : summary;
}

/** The checkpoint itself announces a fold that summarized nothing because every message was oversized. */
function announceOmissions(prior: string | null, skipped: readonly FoldSkip[]): string {
  const note = `[${skipped.length} message${skipped.length === 1 ? "" : "s"} omitted from the durable summary: each exceeded the ${skipped[0]?.budgetTokens ?? CHECKPOINT_FOLD_TOKEN_BUDGET}-token fold budget]`;
  return prior ? `${prior} ${note}` : note;
}

async function recordSafely(deps: AdvanceDeps, outcome: FoldOutcome): Promise<void> {
  try {
    await deps.recordFoldOutcome(outcome);
  } catch (err) {
    // The recorder is the last line of visibility; if it is down we still must
    // not break the advance. This is the one place a console line is all we have.
    console.warn("[thread-checkpoint] outcome record failed:", err);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fold the aged-out messages (older than the newest `keepRecentCount`, newer than
 * the watermark) into the durable summary. Idempotent and safe to call
 * fire-and-forget after every turn: a no-op until CHECKPOINT_FOLD_BATCH messages
 * have aged out, it folds at most one batch per call, and it never re-reads
 * messages already behind the watermark. Call it repeatedly (the nightly sweep
 * does) to converge a long thread.
 */
export async function advanceThreadCheckpoint(
  threadId: string,
  keepRecentCount: number,
  deps: AdvanceDeps,
): Promise<AdvanceResult> {
  let stage: FoldStage = "load-state";
  let eligibleCount = 0;
  try {
    const state = await deps.loadState(threadId);
    if (!state) return { advanced: false, reason: "no-thread" };

    stage = "load-messages";
    const take = checkpointLoadTake(keepRecentCount);
    const page = await deps.loadMessagesAfter(threadId, state.compactionWatermarkAt, take);
    // Only messages that have aged OUT of the live recency window are eligible —
    // keep the newest `keepRecentCount` untouched (they are still sent verbatim).
    // A full page proves the first batch has `keepRecentCount` newer messages
    // behind it; a short page is the whole remaining span.
    const pageFull = page.length >= take;
    const eligible = pageFull
      ? page.slice(0, CHECKPOINT_FOLD_BATCH)
      : keepRecentCount > 0
        ? page.slice(0, -keepRecentCount)
        : page;
    eligibleCount = eligible.length;

    if (eligible.length < CHECKPOINT_FOLD_BATCH) {
      return { advanced: false, reason: "not-enough" };
    }

    const selection = selectFoldBatch(eligible);
    const newestConsumed = eligible[selection.consumed - 1]!;

    stage = "summarize";
    const summary = selection.fold.length > 0
      ? await deps.summarize({
          priorSummary: state.compactedSummary,
          transcript: selection.entries.join("\n\n"),
        })
      : announceOmissions(state.compactedSummary, selection.skipped);

    stage = "save";
    await deps.saveState(threadId, {
      compactedSummary: capSummary(summary),
      compactionWatermarkAt: newestConsumed.createdAt,
      compactedTurnCount: state.compactedTurnCount + selection.consumed,
    });

    for (const skip of selection.skipped) {
      await recordSafely(deps, { kind: "message-skipped", threadId, reason: "exceeds-token-budget", ...skip });
    }

    return {
      advanced: true,
      foldedCount: selection.fold.length,
      skipped: selection.skipped,
      watermarkAt: newestConsumed.createdAt,
      moreEligible: pageFull,
    };
  } catch (err) {
    // Non-fatal: a failed fold must never break the coworker turn — but the
    // outcome is returned and recorded, never discarded (D1: this silence is why
    // the defect survived to 1,100 messages).
    const message = errorMessage(err);
    console.warn(`[thread-checkpoint] advance failed at ${stage}:`, err);
    await recordSafely(deps, { kind: "fold-failed", threadId, stage, message, eligibleCount });
    return { advanced: false, reason: "error", stage, message };
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
