// apps/web/lib/inference/semantic-memory-cleanup.ts
// BI-DG-001: deletion propagation + orphan reconciliation for the semantic-memory
// derived copy. Semantic memory is a projection of coworker conversation
// (spec §"Derived-data contracts"): a source deletion must remove the matching
// vectors, and a scheduled reconciliation must detect and remove vectors whose
// source turn no longer exists ("darkness and orphans become visible within the
// contract SLO"). Both paths are idempotent and emit bounded evidence — counts and
// error codes only, never raw content.

import {
  deleteVectors,
  scrollPoints,
  QDRANT_COLLECTIONS,
  type MatchClause,
  type QdrantFilter,
} from "@dpf/db";

/** Upper bound on how many candidate points one cleanup/reconcile pass inspects. */
export const SEMANTIC_MEMORY_SCAN_LIMIT = 5000;

// Read the collection name lazily (inside functions), never at module load: this
// module is pulled in transitively by the queue barrel, and reading an imported
// `@dpf/db` value at top level can hit a mocked/circular-init `undefined` and crash
// unrelated importers before any function runs.
function agentMemoryCollection(): string {
  return QDRANT_COLLECTIONS.AGENT_MEMORY;
}

export type CleanupSourceKind = "message" | "thread" | "orphan-reconcile";

/** Bounded, non-sensitive cleanup evidence (never carries raw content). */
export interface CleanupEvidence {
  collection: string;
  sourceKind: CleanupSourceKind;
  candidates: number;
  removed: number;
  failed: number;
  errorCodes: string[];
  /** True when the scan hit SEMANTIC_MEMORY_SCAN_LIMIT and more may remain. */
  cappedAtScan: boolean;
}

function dedupe(ids: string[] | undefined): string[] {
  return ids ? [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))] : [];
}

function anyClause(key: string, values: string[]): MatchClause {
  return { key, match: { any: values } };
}

function errorCodeOf(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  if (err instanceof Error) return err.name;
  return "unknown";
}

/**
 * Remove semantic-memory vectors for the given source message and/or thread
 * identifiers. Idempotent: re-running after the vectors are gone finds no
 * candidates and removes nothing. Deletion is keyed only on stable source
 * identifiers already present in the payload — no sensitive value is required.
 */
export async function purgeConversationVectorsBySource(params: {
  messageIds?: string[];
  threadIds?: string[];
}): Promise<CleanupEvidence> {
  const AGENT_MEMORY = agentMemoryCollection();
  const messageIds = dedupe(params.messageIds);
  const threadIds = dedupe(params.threadIds);
  const sourceKind: CleanupSourceKind = threadIds.length > 0 ? "thread" : "message";

  const evidence: CleanupEvidence = {
    collection: AGENT_MEMORY,
    sourceKind,
    candidates: 0,
    removed: 0,
    failed: 0,
    errorCodes: [],
    cappedAtScan: false,
  };

  const should: MatchClause[] = [];
  if (messageIds.length > 0) should.push(anyClause("messageId", messageIds));
  if (threadIds.length > 0) should.push(anyClause("threadId", threadIds));
  if (should.length === 0) return evidence; // nothing requested — idempotent no-op

  const filter: QdrantFilter = { should };
  try {
    const candidates = await scrollPoints(AGENT_MEMORY, filter, SEMANTIC_MEMORY_SCAN_LIMIT);
    evidence.candidates = candidates.length;
    evidence.cappedAtScan = candidates.length >= SEMANTIC_MEMORY_SCAN_LIMIT;
    if (candidates.length === 0) return evidence; // already clean — idempotent
    await deleteVectors(AGENT_MEMORY, filter);
    evidence.removed = candidates.length;
  } catch (err) {
    evidence.failed = evidence.candidates || messageIds.length + threadIds.length;
    evidence.errorCodes.push(errorCodeOf(err));
  }
  return evidence;
}

/**
 * Reconcile a set of candidate message identifiers against their live source and
 * remove the vectors whose source turn no longer exists. `existsResolver` returns
 * the subset of ids that still exist (injected so this module stays free of a
 * Postgres dependency and is unit-testable). Idempotent: once orphans are removed a
 * subsequent pass finds none.
 */
export async function reconcileOrphanConversationVectors(params: {
  candidateMessageIds: string[];
  existsResolver: (messageIds: string[]) => Promise<Set<string>>;
  cappedAtScan?: boolean;
}): Promise<CleanupEvidence & { orphanMessageIds: string[] }> {
  const AGENT_MEMORY = agentMemoryCollection();
  const candidateMessageIds = dedupe(params.candidateMessageIds);
  const evidence: CleanupEvidence & { orphanMessageIds: string[] } = {
    collection: AGENT_MEMORY,
    sourceKind: "orphan-reconcile",
    candidates: candidateMessageIds.length,
    removed: 0,
    failed: 0,
    errorCodes: [],
    cappedAtScan: Boolean(params.cappedAtScan),
    orphanMessageIds: [],
  };
  if (candidateMessageIds.length === 0) return evidence;

  let existing: Set<string>;
  try {
    existing = await params.existsResolver(candidateMessageIds);
  } catch (err) {
    evidence.failed = candidateMessageIds.length;
    evidence.errorCodes.push(errorCodeOf(err));
    return evidence;
  }

  const orphans = candidateMessageIds.filter((id) => !existing.has(id));
  evidence.orphanMessageIds = orphans;
  if (orphans.length === 0) return evidence; // nothing to reconcile — idempotent

  try {
    await deleteVectors(AGENT_MEMORY, { must: [anyClause("messageId", orphans)] });
    evidence.removed = orphans.length;
  } catch (err) {
    evidence.failed = orphans.length;
    evidence.errorCodes.push(errorCodeOf(err));
  }
  return evidence;
}
