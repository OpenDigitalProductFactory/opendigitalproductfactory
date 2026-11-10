// apps/web/lib/tak/thread-history-withholding.ts
//
// BI-706530B2, structural half. Operator-ratified 2026-09-07 against kernel
// DI-B60AD9E7746F: do not age the EVIDENCE, age the PAYLOAD.
//
// A thread pinned to local-only by something in its history recovers by no
// longer SENDING that history — not by deciding to stop looking at it. The
// screen keeps scoring the whole payload exactly as before; the payload simply
// becomes smaller. What is screened stays what is dispatched, which is the
// invariant the alternative (a recency window over evidence that is still
// transmitted) would have broken.
//
// The load-bearing detail is that a coworker thread reintroduces its own past
// through THREE independent doors, and a boundary honoured by only some of them
// is worse than none: it would report normal routing while the withheld text
// still travelled.
//
//   1. the raw recency window   — bounded by `createdAt >= boundary`
//   2. the rolling checkpoint   — a persisted SUMMARY of turns older than the
//                                 window, i.e. precisely the withheld span,
//                                 rewritten. Suppressed wholesale.
//   3. semantic recall          — vector lookup over the thread's own messages,
//                                 which will happily surface a withheld turn.
//                                 Withheld ids join the recall exclusion set.
//
// Withholding is dispatch-only. Nothing is deleted, and the messages stay in
// the operator's own record — this is a boundary on what leaves the box, not an
// edit to the conversation.

export type WithheldHistory = {
  /** Messages at or after this instant may be dispatched. Null = withhold nothing. */
  boundary: Date | null;
  /** Ids withheld from dispatch, for the semantic-recall exclusion set. */
  withheldMessageIds: Set<string>;
};

export const NO_WITHHELD_HISTORY: WithheldHistory = Object.freeze({
  boundary: null,
  withheldMessageIds: new Set<string>(),
});

type MessageRow = { id: string; createdAt: Date };

/**
 * Split a thread's messages against its withholding boundary.
 *
 * Pure so the door-by-door behaviour is testable without a database: the
 * failure this guards against is a door that silently keeps its own copy.
 */
export function splitWithheldHistory(
  messages: readonly MessageRow[],
  boundary: Date | null,
): WithheldHistory {
  if (!boundary) return { boundary: null, withheldMessageIds: new Set() };
  const withheldMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.createdAt.getTime() < boundary.getTime()) withheldMessageIds.add(message.id);
  }
  return { boundary, withheldMessageIds };
}

/**
 * The `createdAt` clause for the raw recency window. Door 1.
 *
 * Returns undefined rather than an always-true clause so an unwithheld thread
 * produces the exact query it produced before this existed.
 */
export function historyWindowClause(boundary: Date | null): { gte: Date } | undefined {
  return boundary ? { gte: boundary } : undefined;
}

/**
 * Whether the rolling thread checkpoint may be prepended. Door 2.
 *
 * A checkpoint summarises the turns OLDER than the recency window — which is
 * the withheld span itself, restated in prose. A summary of governed text is
 * still governed text, so any withholding suppresses the checkpoint entirely
 * rather than trying to rewrite it: re-deriving a checkpoint from the surviving
 * turns would require dispatching the withheld ones to do it.
 */
export function checkpointAllowed(boundary: Date | null): boolean {
  return boundary === null;
}

/**
 * The recall exclusion set. Door 3.
 *
 * Semantic recall already excludes whatever is in the live window; withheld
 * messages are by definition NOT in the window, so without this they are
 * exactly the rows recall is most free to return.
 */
export function recallExclusionSet(
  windowMessageIds: ReadonlySet<string>,
  withheld: WithheldHistory,
): Set<string> {
  return new Set([...windowMessageIds, ...withheld.withheldMessageIds]);
}

type ThreadHistoryReader = {
  agentThread: { findUnique: (args: never) => Promise<{ historyWithheldBefore: Date | null } | null> };
  agentMessage: { findMany: (args: never) => Promise<MessageRow[]> };
};

/**
 * Resolve a thread's withholding boundary into the three door-specific answers
 * its dispatch path needs.
 *
 * Assembled here rather than at the call site so a future fourth door has one
 * obvious place to be wired, and so the caller cannot honour two doors and
 * forget the third — the failure mode this whole module exists to prevent.
 */
export async function resolveWithheldHistory(
  db: unknown,
  threadId: string,
): Promise<{
  boundary: Date | null;
  windowWhere: { createdAt: { gte: Date } } | Record<string, never>;
  checkpointAllowed: boolean;
  recallExclusions: (windowMessageIds: ReadonlySet<string>) => Set<string>;
}> {
  const reader = db as ThreadHistoryReader;
  const thread = await reader.agentThread.findUnique({
    where: { id: threadId },
    select: { historyWithheldBefore: true },
  } as never);
  const boundary = thread?.historyWithheldBefore ?? null;

  if (!boundary) {
    return {
      boundary: null,
      windowWhere: {},
      checkpointAllowed: true,
      recallExclusions: (windowMessageIds) => new Set(windowMessageIds),
    };
  }

  const older = await reader.agentMessage.findMany({
    where: { threadId, createdAt: { lt: boundary } },
    select: { id: true, createdAt: true },
  } as never);
  const split = splitWithheldHistory(older, boundary);

  return {
    boundary,
    windowWhere: { createdAt: { gte: boundary } },
    checkpointAllowed: checkpointAllowed(boundary),
    recallExclusions: (windowMessageIds) => recallExclusionSet(windowMessageIds, split),
  };
}
