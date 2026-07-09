// apps/web/lib/tak/memory-consolidation.ts
// Write-time memory consolidation gate — BI-840FDD43 (EP-8C706944 Phase 2).
//
// Both UserFact (upsertUserFact) and CoworkerMemoryNote (recordCoworkerNote)
// supersede only on an EXACT key match, so two entries that mean the same thing
// under different keys ("preferred_meeting_time" vs "meeting_time") both persist,
// and the stores accumulate near-duplicates and unresolved contradictions.
//
// This gate generalizes the exact-key rule: given a candidate entry and the
// active entries in its scope, it classifies the write as ADD / NOOP / UPDATE /
// SUPERSEDE against the nearest neighbor (mem0's consolidation controller,
// adapted to a deterministic lexical similarity so the decision is unit-testable
// without a model). The caller applies the decision with its existing
// supersede-with-provenance machinery — this module decides, it does not write.

export type ConsolidationAction = "add" | "noop" | "update" | "supersede";

export type ExistingEntry = {
  id: string;
  key: string;
  value: string;
};

export type ConsolidationDecision =
  | { action: "add"; targetId: null; reason: string }
  | { action: "noop"; targetId: string; reason: string }
  | { action: "update"; targetId: string; reason: string }
  | { action: "supersede"; targetId: string; reason: string };

/**
 * Key-token similarity at or above which two entries are treated as the same
 * concept. Matching is driven by the KEY, not the value: two facts about the
 * same thing share key tokens ("preferred_cloud_provider" ≈ "cloud_provider"),
 * and whether the VALUE differs is what separates supersede from noop. Including
 * value tokens here would dilute the signal exactly in the supersede case (same
 * concept, changed value), so the value is compared separately for equality.
 */
export const DEFAULT_SUPERSEDE_THRESHOLD = 0.6;

/** Normalize text to a comparable token set (lowercase, alphanumeric words). */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0),
  );
}

/** Jaccard similarity over two token sets (0..1). */
function jaccard(ta: Set<string>, tb: Set<string>): number {
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Jaccard similarity over the entries' KEY token sets (the same-concept signal). */
export function entrySimilarity(
  a: { key: string; value: string },
  b: { key: string; value: string },
): number {
  return jaccard(tokenize(a.key), tokenize(b.key));
}

function normalizedEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Classify a candidate write against the active entries in its scope.
 *
 * - NOOP: an existing entry has the same key and an equivalent value, OR a
 *   near-duplicate (different key) already states the same value — nothing to do.
 * - UPDATE: same key, different value — refresh the existing entry in place.
 * - SUPERSEDE: a different-key near-neighbor (>= threshold) holds a different
 *   value — replace it so the store keeps one canonical entry, not two.
 * - ADD: no equivalent or near neighbor — store fresh.
 */
export function classifyConsolidation(
  candidate: { key: string; value: string },
  existing: ExistingEntry[],
  opts?: { supersedeThreshold?: number },
): ConsolidationDecision {
  const threshold = opts?.supersedeThreshold ?? DEFAULT_SUPERSEDE_THRESHOLD;

  // 1. Exact-key handling (preserves the current behavior of both stores).
  const exact = existing.find((e) => e.key === candidate.key);
  if (exact) {
    return normalizedEqual(exact.value, candidate.value)
      ? { action: "noop", targetId: exact.id, reason: "exact key, equivalent value" }
      : { action: "update", targetId: exact.id, reason: "exact key, changed value" };
  }

  // 2. Nearest different-key neighbor.
  let best: { entry: ExistingEntry; sim: number } | null = null;
  for (const e of existing) {
    const sim = entrySimilarity(candidate, e);
    if (!best || sim > best.sim) best = { entry: e, sim };
  }

  if (best && best.sim >= threshold) {
    return normalizedEqual(best.entry.value, candidate.value)
      ? {
          action: "noop",
          targetId: best.entry.id,
          reason: `near-duplicate (sim ${best.sim.toFixed(2)}) with equivalent value`,
        }
      : {
          action: "supersede",
          targetId: best.entry.id,
          reason: `near-duplicate (sim ${best.sim.toFixed(2)}) with changed value`,
        };
  }

  return { action: "add", targetId: null, reason: "no equivalent or near neighbor" };
}
