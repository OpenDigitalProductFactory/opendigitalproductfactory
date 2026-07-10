// apps/web/lib/tak/memory-consolidation-sweep.ts
// Batch consolidation planner for the sleep-time pass — BI-907C4327
// (EP-8C706944 Phase 2).
//
// The write-time gate (memory-consolidation.ts) only compares a NEW entry to the
// existing set. Over time, entries written before their eventual duplicates
// still coexist. The nightly pass sweeps a whole scope and collapses
// near-duplicate clusters to one canonical entry, keeping the most recent and
// superseding the rest.
//
// Pure and deterministic: given the active entries (newest-first) it returns the
// supersede plan; the runner applies it with the existing provenance machinery.

import { classifyConsolidation, type ExistingEntry } from "./memory-consolidation";

/** An active entry to consider, carrying its recency for canonical selection. */
export type SweepEntry = ExistingEntry & { createdAt: Date };

/** One planned supersession: `loserId` is retired in favor of `winnerId`. */
export type SupersedePlanItem = { loserId: string; winnerId: string; reason: string };

/**
 * Plan the supersessions needed to collapse near-duplicate clusters in one
 * scope. Entries are processed newest-first; the first representative of each
 * cluster is the canonical "winner" and later (older) near-duplicates are
 * superseded by it. An entry that matches no kept winner becomes a new winner.
 */
export function planBatchDedupe(
  entries: SweepEntry[],
  opts?: { supersedeThreshold?: number },
): SupersedePlanItem[] {
  const byNewest = [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const winners: ExistingEntry[] = [];
  const plan: SupersedePlanItem[] = [];

  for (const entry of byNewest) {
    const decision = classifyConsolidation(
      { key: entry.key, value: entry.value },
      winners,
      opts,
    );
    if (decision.action === "add") {
      winners.push({ id: entry.id, key: entry.key, value: entry.value });
    } else {
      // noop / update / supersede all mean "same concept as an existing winner":
      // this older entry is redundant → supersede it in favor of the winner.
      plan.push({
        loserId: entry.id,
        winnerId: decision.targetId,
        reason: `batch dedupe: ${decision.reason}`,
      });
    }
  }
  return plan;
}
